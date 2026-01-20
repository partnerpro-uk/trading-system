"""ForexFactoryScraper
A web scraper that downloads forex calendar data from ForexFactory, optimized for Convex DB.

USAGE:
  python ffs.py                      # Scrape historical + future events
  python ffs.py --start-date 2024-01-01  # Start from specific date
  python ffs.py --future-only        # Only scrape future/scheduled events
  python ffs.py --days-ahead 30      # Scrape up to 30 days in the future
  python ffs.py --output my_data.jsonl   # Custom output file

OUTPUT FORMAT: JSONL (forex_factory_catalog.jsonl)
  - One JSON object per line for streaming/import
  - Timestamps in UTC milliseconds (Convex-native)
  - Normalized impact levels (high/medium/low/non_economic)
  - Unique event IDs for deduplication
  - Event status: scheduled/released for upsert logic

CONVEX-READY FIELDS:
  - event_id: Unique ID "{name}_{currency}_{YYYY-MM-DD}_{HH:MM}"
  - status: "scheduled" (future, no actual) or "released" (has actual value)
  - timestamp_utc: UTC milliseconds (int)
  - scraped_at: When this record was scraped (UTC ms) - for upsert tracking
  - datetime_utc/datetime_new_york/datetime_london: Human-readable times
  - day_of_week: Mon/Tue/Wed/Thu/Fri/Sat/Sun
  - trading_session: asian/london/new_york/london_ny_overlap/off_hours
  - currency: USD/GBP/EUR/JPY etc.
  - source_tz: Source timezone name
  - impact: high/medium/low/non_economic (normalized)
  - event: Event name
  - actual/forecast/previous: Raw values (null if not available)
  - deviation/deviation_pct: Numeric values (null if not calculable)
  - outcome: beat/miss/met (null for scheduled events)

JSONL EXAMPLE:
  {"event_id": "CPI_m_m_USD_2024-01-15_14:30", "status": "released",
   "timestamp_utc": 1705329000000, "scraped_at": 1705400000000,
   "currency": "USD", "impact": "high", "event": "CPI m/m", "outcome": "beat"}

Requires Google Chrome. Non-headless mode due to Cloudflare DDoS protection.
"""
import argparse
import json
import logging
import random
import re
import time
from datetime import datetime, timedelta
from os import path

import undetected_chromedriver as uc
from dateutil.tz import gettz
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scraper.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# DST-aware IANA timezones for major forex centers
TZ_UTC = gettz('UTC')
TZ_NEW_YORK = gettz('America/New_York')  # EST/EDT automatic
TZ_LONDON = gettz('Europe/London')        # GMT/BST automatic

# Currency to source timezone mapping (where economic data is released from)
CURRENCY_TIMEZONES = {
    'USD': gettz('America/New_York'),
    'GBP': gettz('Europe/London'),
    'EUR': gettz('Europe/Berlin'),      # ECB is in Frankfurt
    'JPY': gettz('Asia/Tokyo'),
    'AUD': gettz('Australia/Sydney'),
    'NZD': gettz('Pacific/Auckland'),
    'CAD': gettz('America/Toronto'),
    'CHF': gettz('Europe/Zurich'),
    'CNY': gettz('Asia/Shanghai'),
    'HKD': gettz('Asia/Hong_Kong'),
    'SGD': gettz('Asia/Singapore'),
    'SEK': gettz('Europe/Stockholm'),
    'NOK': gettz('Europe/Oslo'),
    'MXN': gettz('America/Mexico_City'),
    'ZAR': gettz('Africa/Johannesburg'),
    'INR': gettz('Asia/Kolkata'),
}

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 2  # seconds
MAX_DELAY = 30  # seconds

# Output configuration
JSONL_FILENAME = 'forex_factory_catalog.jsonl'

# Impact normalization mapping (ForexFactory -> Convex)
IMPACT_MAPPING = {
    'High Impact Expected': 'high',
    'Medium Impact Expected': 'medium',
    'Low Impact Expected': 'low',
    'Non-Economic': 'non_economic',
    '': 'non_economic',  # Default for empty
}

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import Select
from selenium.webdriver.support.wait import WebDriverWait


def parse_numeric_value(value):
    """Parse a numeric value from forex factory format.

    Handles formats like: 1.5%, 100K, 2.5M, 1.2B, -0.5%, etc.

    Args:
        value (str): The string value to parse.

    Returns:
        float or None: The parsed numeric value, or None if unparseable.
    """
    if not value or value.strip() == '':
        return None

    value = value.strip().replace(',', '')

    # Remove any HTML entities or special characters
    value = value.replace('&nbsp;', '').replace('\xa0', '')

    multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000, 'T': 1_000_000_000_000}
    multiplier = 1

    # Check for percentage (remove % sign for parsing)
    if '%' in value:
        value = value.replace('%', '')

    # Check for magnitude suffix
    for suffix, mult in multipliers.items():
        if suffix in value.upper():
            multiplier = mult
            value = value.upper().replace(suffix, '')
            break

    try:
        result = float(value) * multiplier
        return result
    except (ValueError, TypeError):
        return None


def calculate_outcome(actual, forecast):
    """Calculate the outcome based on actual vs forecast values.

    Args:
        actual (str): The actual reported value.
        forecast (str): The forecasted value.

    Returns:
        str: 'beat', 'miss', 'met', or '' if comparison not possible.
    """
    actual_num = parse_numeric_value(actual)
    forecast_num = parse_numeric_value(forecast)

    if actual_num is None or forecast_num is None:
        return ''

    # Use small epsilon for float comparison
    epsilon = abs(forecast_num * 0.0001) if forecast_num != 0 else 0.0001

    if actual_num > forecast_num + epsilon:
        return 'beat'
    elif actual_num < forecast_num - epsilon:
        return 'miss'
    else:
        return 'met'


def get_source_timezone(currency):
    """Get the source timezone for a currency's economic releases.

    Args:
        currency (str): The currency code (e.g., 'USD', 'GBP').

    Returns:
        tuple: (timezone object, timezone name string)
    """
    tz = CURRENCY_TIMEZONES.get(currency.upper(), TZ_UTC)
    # Get a readable name for the timezone
    tz_names = {
        'America/New_York': 'US/Eastern',
        'Europe/London': 'UK/London',
        'Europe/Berlin': 'EU/Frankfurt',
        'Asia/Tokyo': 'Asia/Tokyo',
        'Australia/Sydney': 'AU/Sydney',
        'Pacific/Auckland': 'NZ/Auckland',
        'America/Toronto': 'CA/Toronto',
        'Europe/Zurich': 'CH/Zurich',
        'Asia/Shanghai': 'CN/Shanghai',
        'Asia/Hong_Kong': 'HK/HongKong',
        'Asia/Singapore': 'SG/Singapore',
        'Europe/Stockholm': 'SE/Stockholm',
        'Europe/Oslo': 'NO/Oslo',
        'America/Mexico_City': 'MX/Mexico',
        'Africa/Johannesburg': 'ZA/Joburg',
        'Asia/Kolkata': 'IN/Mumbai',
    }
    # Find the name by matching the timezone
    for iana, name in tz_names.items():
        if tz == gettz(iana):
            return tz, name
    return tz, 'UTC'


def calculate_deviation(actual, forecast):
    """Calculate numeric deviation and percentage deviation.

    Args:
        actual (str): The actual reported value.
        forecast (str): The forecasted value.

    Returns:
        tuple: (deviation, deviation_pct) as strings, or ('', '') if not calculable.
    """
    actual_num = parse_numeric_value(actual)
    forecast_num = parse_numeric_value(forecast)

    if actual_num is None or forecast_num is None:
        return '', ''

    deviation = actual_num - forecast_num

    if forecast_num != 0:
        deviation_pct = (deviation / abs(forecast_num)) * 100
        return f'{deviation:.4g}', f'{deviation_pct:.2f}'
    else:
        return f'{deviation:.4g}', ''


def get_trading_session(dt):
    """Determine the forex trading session based on time.

    Trading sessions (in UTC):
    - Sydney/Asian: 21:00 - 06:00 UTC
    - London: 07:00 - 16:00 UTC
    - New York: 12:00 - 21:00 UTC

    Args:
        dt (datetime): The timezone-aware datetime.

    Returns:
        str: The trading session name.
    """
    utc_hour = dt.astimezone(TZ_UTC).hour

    # Define session ranges (in UTC hours)
    sydney_start, sydney_end = 21, 6    # 21:00 - 06:00 (wraps midnight)
    london_start, london_end = 7, 16    # 07:00 - 16:00
    ny_start, ny_end = 12, 21           # 12:00 - 21:00

    in_sydney = utc_hour >= sydney_start or utc_hour < sydney_end
    in_london = london_start <= utc_hour < london_end
    in_ny = ny_start <= utc_hour < ny_end

    # Check for overlaps first (most active periods)
    if in_london and in_ny:
        return 'london_ny_overlap'
    elif in_sydney and in_london:
        return 'asian_london_overlap'
    elif in_london:
        return 'london'
    elif in_ny:
        return 'new_york'
    elif in_sydney:
        return 'asian'
    else:
        return 'off_hours'


def get_day_of_week(dt):
    """Get the day of week abbreviation.

    Args:
        dt (datetime): The datetime.

    Returns:
        str: Day abbreviation (Mon, Tue, Wed, Thu, Fri, Sat, Sun).
    """
    return dt.strftime('%a')


def normalize_event_name(name):
    """Normalize event name for use in event ID.

    Replaces non-alphanumeric characters with underscores, truncates to 20 chars.

    Args:
        name (str): The raw event name.

    Returns:
        str: Normalized name suitable for ID.
    """
    # Replace non-alphanumeric with underscore
    normalized = re.sub(r'[^a-zA-Z0-9]', '_', name)
    # Remove consecutive underscores
    normalized = re.sub(r'_+', '_', normalized)
    # Remove leading/trailing underscores
    normalized = normalized.strip('_')
    # Truncate to 20 characters
    return normalized[:20]


def generate_event_id(event_name, currency, dt):
    """Generate a unique event ID for Convex.

    Format: {normalized_name}_{currency}_{YYYY-MM-DD}_{HH:MM}

    Args:
        event_name (str): The event name.
        currency (str): The currency code.
        dt (datetime): The event datetime (timezone-aware).

    Returns:
        str: Unique event ID.
    """
    normalized_name = normalize_event_name(event_name)
    dt_utc = dt.astimezone(TZ_UTC)
    date_str = dt_utc.strftime('%Y-%m-%d')
    time_str = dt_utc.strftime('%H:%M')
    return f"{normalized_name}_{currency}_{date_str}_{time_str}"


def normalize_impact(raw_impact):
    """Normalize impact level for Convex.

    Args:
        raw_impact (str): Raw impact from ForexFactory (e.g., "High Impact Expected").

    Returns:
        str: Normalized impact (high/medium/low/non_economic).
    """
    return IMPACT_MAPPING.get(raw_impact, 'non_economic')


def datetime_to_utc_ms(dt):
    """Convert datetime to UTC milliseconds.

    Args:
        dt (datetime): Timezone-aware datetime.

    Returns:
        int: UTC milliseconds since epoch.
    """
    return int(dt.astimezone(TZ_UTC).timestamp() * 1000)


def determine_event_status(actual):
    """Determine if an event is scheduled or released.

    Args:
        actual (str): The actual value from the event.

    Returns:
        str: 'released' if actual has a value, 'scheduled' otherwise.
    """
    if actual and actual.strip():
        return 'released'
    return 'scheduled'


def build_event_record(dt, currency, source_tz_name, raw_impact, event_name,
                       actual, forecast, previous, outcome):
    """Build a Convex-ready event record as a dictionary.

    Args:
        dt (datetime): Timezone-aware datetime of the event.
        currency (str): Currency code.
        source_tz_name (str): Source timezone name.
        raw_impact (str): Raw impact from ForexFactory.
        event_name (str): Event name.
        actual (str): Actual value.
        forecast (str): Forecast value.
        previous (str): Previous value.
        outcome (str): beat/miss/met or empty.

    Returns:
        dict: Convex-ready event record.
    """
    # Generate unique event ID
    event_id = generate_event_id(event_name, currency, dt)

    # Get timestamps in UTC milliseconds
    timestamp_utc = datetime_to_utc_ms(dt)
    scraped_at = datetime_to_utc_ms(datetime.now(tz=TZ_UTC))

    # Get human-readable datetime strings for reference
    dt_utc = dt.astimezone(TZ_UTC)
    dt_ny = dt.astimezone(TZ_NEW_YORK)
    dt_london = dt.astimezone(TZ_LONDON)

    # Calculate deviation
    deviation, deviation_pct = calculate_deviation(actual, forecast)

    # Convert deviation to float if possible
    dev_num = None
    if deviation != '':
        try:
            dev_num = float(deviation)
        except (ValueError, TypeError):
            pass

    dev_pct_num = None
    if deviation_pct != '':
        try:
            dev_pct_num = float(deviation_pct)
        except (ValueError, TypeError):
            pass

    # Determine event status
    status = determine_event_status(actual)

    return {
        'event_id': event_id,
        'status': status,
        'timestamp_utc': timestamp_utc,
        'scraped_at': scraped_at,
        'datetime_utc': dt_utc.strftime('%Y-%m-%d %H:%M:%S'),
        'datetime_new_york': dt_ny.strftime('%Y-%m-%d %H:%M:%S'),
        'datetime_london': dt_london.strftime('%Y-%m-%d %H:%M:%S'),
        'day_of_week': get_day_of_week(dt),
        'trading_session': get_trading_session(dt),
        'currency': currency,
        'source_tz': source_tz_name,
        'impact': normalize_impact(raw_impact),
        'event': event_name,
        'actual': actual if actual else None,
        'forecast': forecast if forecast else None,
        'previous': previous if previous else None,
        'deviation': dev_num,
        'deviation_pct': dev_pct_num,
        'outcome': outcome if outcome else None
    }


def write_jsonl_record(record):
    """Append a single JSON record to the JSONL file.

    Args:
        record (dict): The record to write.
    """
    with open(JSONL_FILENAME, 'a') as f:
        f.write(json.dumps(record) + '\n')


def retry_with_backoff(func, *args, **kwargs):
    """Execute a function with exponential backoff retry logic.

    Args:
        func: The function to execute.
        *args: Positional arguments for the function.
        **kwargs: Keyword arguments for the function.

    Returns:
        The return value of the function.

    Raises:
        Exception: If all retries are exhausted.
    """
    for attempt in range(MAX_RETRIES):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                logger.error(f'All {MAX_RETRIES} retries exhausted. Last error: {e}')
                raise

            delay = min(BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), MAX_DELAY)
            logger.warning(f'Attempt {attempt + 1} failed: {e}. Retrying in {delay:.1f}s...')
            time.sleep(delay)


def setup_driver():
    """Setup Chrome with undetected-chromedriver to bypass Cloudflare.

    Returns:
        uc.Chrome: The configured Chrome driver.
    """
    options = uc.ChromeOptions()
    # options.headless = True
    options.add_argument('--no-first-run --no-service-autorun --password-store=basic')
    return uc.Chrome(options=options)


def get_timezone(driver):
    """Extracts the current default timezone from the website.

    Falls back to America/New_York (EST) if unable to detect - this is ForexFactory's default.

    Returns:
        timezone: the timezone
    """
    try:
        driver.get('https://www.forexfactory.com/timezone.php')
        # Try the old select element first
        try:
            select = Select(WebDriverWait(driver, 5).until(
                ec.presence_of_element_located((By.ID, 'timezone'))))
            tz_name = select.first_selected_option.text[1:10]
            return gettz(tz_name)
        except Exception:
            pass

        # Try to find timezone in page source (new site structure)
        soup = BeautifulSoup(driver.page_source, 'lxml')
        # Look for timezone indicator in various places
        tz_element = soup.find(class_='timezone') or soup.find(id='timezone')
        if tz_element and tz_element.text:
            tz_text = tz_element.text.strip()
            # Extract timezone from text like "(GMT-5:00) Eastern Time"
            if 'Eastern' in tz_text:
                return gettz('America/New_York')
            elif 'Pacific' in tz_text:
                return gettz('America/Los_Angeles')
            elif 'Central' in tz_text:
                return gettz('America/Chicago')
            elif 'London' in tz_text or 'GMT' in tz_text:
                return gettz('Europe/London')

    except Exception as e:
        logger.warning(f'Could not detect timezone: {e}')

    # Default to EST - ForexFactory's standard timezone
    logger.info('Using default timezone: America/New_York (EST)')
    return gettz('America/New_York')


def navigate_to_date(driver, target_date):
    """Navigate to a specific date using the mini calendar widget (one-time).

    Uses the mini calendar arrows to navigate to the target month/year,
    then clicks the WEEK arrow (») to load the entire week containing
    our target date. This loads 7 days of events at once.

    Args:
        driver: The Selenium WebDriver.
        target_date: The datetime to navigate to.

    Returns:
        bool: True if navigation succeeded.
    """
    # Go to the calendar page
    driver.get('https://www.forexfactory.com/calendar')
    time.sleep(2)

    max_navigation_attempts = 200

    for attempt in range(max_navigation_attempts):
        try:
            # Find the mini calendar header
            header = WebDriverWait(driver, 5).until(
                ec.presence_of_element_located((By.CSS_SELECTOR, 'div.calendarmini__header'))
            )

            month_year_div = header.find_element(By.CSS_SELECTOR, 'div')
            header_text = month_year_div.text.strip()

            try:
                current_date = datetime.strptime(header_text, '%b %Y')
            except ValueError:
                logger.warning(f'Could not parse calendar header: {header_text}')
                return False

            year_diff = target_date.year - current_date.year
            month_diff = target_date.month - current_date.month

            # If at the right month/year, find and click the week arrow
            if year_diff == 0 and month_diff == 0:
                target_day = target_date.day

                # Find all week rows in the mini calendar
                # Each week row has a » shortcut arrow on the left
                week_shortcuts = driver.find_elements(
                    By.CSS_SELECTOR,
                    'div.calendarmini__shortcut a'
                )

                # Find all day cells to map which week contains our target day
                day_cells = driver.find_elements(
                    By.CSS_SELECTOR,
                    'div.calendarmini__day:not(.calendarmini__day--header)'
                )

                # Group days into weeks (7 days per row)
                weeks = []
                current_week = []
                for i, cell in enumerate(day_cells):
                    current_week.append(cell)
                    if (i + 1) % 7 == 0:
                        weeks.append(current_week)
                        current_week = []
                if current_week:
                    weeks.append(current_week)

                # Find which week contains our target day and click that specific week button
                # Week buttons are at indices 1-5 (index 0 is the month button which shows incomplete data)
                for week_idx, week in enumerate(weeks):
                    for cell in week:
                        cell_text = cell.text.strip()
                        cell_class = cell.get_attribute('class') or ''
                        # Check if this is our target day in the current month
                        if cell_text == str(target_day) and 'calendarmini__day--other' not in cell_class:
                            shortcut_idx = week_idx + 1  # +1 to skip month button at index 0
                            if shortcut_idx < len(week_shortcuts):
                                week_shortcuts[shortcut_idx].click()
                                time.sleep(2)
                                logger.info(f'Navigated to week containing {target_date.strftime("%Y-%m-%d")} via mini calendar')
                                return True

                # Fallback: click first week button (index 1)
                if len(week_shortcuts) > 1:
                    week_shortcuts[1].click()
                    time.sleep(2)
                    logger.info(f'Navigated to first week of {target_date.strftime("%Y-%m")}')
                    return True

                logger.warning(f'Could not find week containing day {target_day}')
                return False

            # Navigate using header arrows
            arrows = header.find_elements(By.CSS_SELECTOR, 'a')

            if year_diff < 0:
                for arrow in arrows:
                    if '«' in arrow.text:
                        arrow.click()
                        time.sleep(0.5)
                        break
            elif year_diff > 0:
                for arrow in arrows:
                    if '»' in arrow.text:
                        arrow.click()
                        time.sleep(0.5)
                        break
            elif month_diff < 0:
                for arrow in arrows:
                    if '‹' in arrow.text:
                        arrow.click()
                        time.sleep(0.5)
                        break
            elif month_diff > 0:
                for arrow in arrows:
                    if '›' in arrow.text:
                        arrow.click()
                        time.sleep(0.5)
                        break

        except Exception as e:
            logger.warning(f'Navigation attempt {attempt} failed: {e}')
            if attempt >= 5:
                return False
            time.sleep(1)

    logger.warning(f'Exceeded max navigation attempts')
    return False


def click_next_week(driver):
    """Click the next month arrow on the calendar page.

    Uses the » arrow on the main calendar to advance to the next month.

    Returns:
        bool: True if successful.
    """
    try:
        # Find the next pagination link
        next_btn = WebDriverWait(driver, 5).until(
            ec.presence_of_element_located((By.CSS_SELECTOR, 'a.calendar__pagination--next'))
        )
        # Scroll element into view to avoid click interception by sticky headers
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", next_btn)
        time.sleep(0.5)
        # Use JavaScript click to bypass any overlay issues
        driver.execute_script("arguments[0].click();", next_btn)
        time.sleep(2)  # Wait for page to load
        return True
    except Exception as e:
        logger.warning(f'Failed to click next month: {e}')
        return False


def get_current_week_dates(driver):
    """Get the date range of the currently displayed week.

    Returns:
        tuple: (start_date, end_date) as datetime objects, or (None, None) on failure.
    """
    try:
        soup = BeautifulSoup(driver.page_source, 'lxml')
        # Find date cells in the calendar
        date_cells = soup.select('td.calendar__cell.calendar__date')
        dates = []
        for cell in date_cells:
            text = cell.text.strip()
            if text:  # e.g., "Mon Jan 20"
                dates.append(text)
        return dates[0] if dates else None, dates[-1] if dates else None
    except Exception:
        return None, None


def fetch_page_after_navigation(driver):
    """Parse the current page after calendar navigation.

    Scrolls incrementally to ensure all events are loaded (lazy loading).

    Returns:
        BeautifulSoup: Parsed page content.
    """
    time.sleep(1)  # Initial load

    # Scroll incrementally to trigger lazy loading of all events
    # Some sites load content in chunks as you scroll
    scroll_height = driver.execute_script("return document.body.scrollHeight")
    scroll_step = scroll_height // 4
    for i in range(1, 5):
        driver.execute_script(f"window.scrollTo(0, {scroll_step * i});")
        time.sleep(0.5)

    # Final scroll to absolute bottom
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(1)

    # Scroll back to top
    driver.execute_script("window.scrollTo(0, 0);")
    time.sleep(0.5)

    soup = BeautifulSoup(driver.page_source, 'lxml')
    table = soup.find('table', class_='calendar__table')
    if table is None:
        raise Exception('Calendar table not found - page may not have loaded correctly')
    return soup


def fetch_page(driver, url):
    """Fetch a page with the driver. Used with retry_with_backoff.

    Args:
        driver: The Selenium WebDriver.
        url: The URL to fetch.

    Returns:
        BeautifulSoup: Parsed page content.
    """
    driver.get(url)
    # Wait for page to fully load (actuals load via JavaScript)
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, 'lxml')
    table = soup.find('table', class_='calendar__table')
    if table is None:
        raise Exception('Calendar table not found - page may not have loaded correctly')
    return soup


def scrap(timezone, start_date_override=None, days_ahead=30, output_file=None, future_only=False, use_calendar_nav=False):
    """Scrap the event data from the web.

    Outputs to JSONL format optimized for Convex DB.

    Args:
        timezone: The output time zone (kept for backwards compatibility).
        start_date_override (str): Optional start date in YYYY-MM-DD format.
        days_ahead (int): Number of days ahead to scrape for future events.
        output_file (str): Optional output file path.
        future_only (bool): If True, only scrape future/scheduled events.
        use_calendar_nav (bool): If True, use calendar widget navigation instead of URL parameters.
    """
    global JSONL_FILENAME
    if output_file:
        JSONL_FILENAME = output_file

    # Initialize output
    logger.info(f'JSONL output: {JSONL_FILENAME}')

    driver = setup_driver()
    try:
        ff_timezone = get_timezone(driver)

        # Determine start date
        if start_date_override:
            start_date = datetime.strptime(start_date_override, '%Y-%m-%d').replace(
                hour=0, minute=0, second=0, tzinfo=ff_timezone)
            logger.info(f'Using override start date: {start_date}')
        elif future_only:
            start_date = datetime.now(tz=ff_timezone).replace(
                hour=0, minute=0, second=0)
            logger.info(f'Future-only mode, starting from today: {start_date}')
        else:
            start_date = get_start_dt(ff_timezone)

        # Calculate end date - relative to start_date, not today
        end_date = start_date + timedelta(days=days_ahead)
        logger.info(f'Will scrape {days_ahead} days: {start_date.strftime("%Y-%m-%d")} to {end_date.strftime("%Y-%m-%d")}')

        # Keep original start date for loop detection (since start_date gets updated)
        original_start_date = start_date

        fields = ['date', 'time', 'currency', 'impact', 'event', 'actual', 'forecast', 'previous']

        logger.info(f'Starting scrape from {start_date}')

        # For calendar navigation: navigate to start date ONCE, then use week arrows
        if use_calendar_nav:
            if not navigate_to_date(driver, start_date):
                logger.error(f'Failed to navigate to start date {start_date.strftime("%Y-%m-%d")}')
                return
            navigated_initially = True
        else:
            navigated_initially = False

        week_count = 0
        while True:
            # For calendar nav mode after first iteration, use week arrows
            if use_calendar_nav and week_count > 0:
                if not click_next_week(driver):
                    logger.error('Failed to advance to next week')
                    break

            week_count += 1

            # Fetch page content
            try:
                if use_calendar_nav:
                    soup = fetch_page_after_navigation(driver)
                    date_url = f'week_{week_count}'  # For logging
                else:
                    try:
                        date_url = dt_to_url(start_date, allow_future=True)
                    except ValueError:
                        logger.info('Successfully retrieved all data')
                        return
                    url = 'https://www.forexfactory.com/' + date_url
                    soup = retry_with_backoff(fetch_page, driver, url)
            except Exception as e:
                logger.error(f'Failed to fetch page: {e}')
                if use_calendar_nav:
                    break  # Can't recover in calendar nav mode
                else:
                    start_date = get_next_dt(start_date, mode=get_mode(date_url))
                    continue

            table = soup.find('table', class_='calendar__table')
            table_rows = [row for row in table.select('tr.calendar__row')
                         if 'calendar__row--day-breaker' not in row.get('class', [])]
            date = None
            rows_written = 0
            last_date_on_page = None
            first_date_on_page = None

            for table_row in table_rows:
                try:
                    currency, impact, event, actual, forecast, previous = '', '', '', '', '', ''
                    for field in fields:
                        cells = table_row.select('td.calendar__cell.calendar__{0}'.format(field))
                        if not cells:
                            continue
                        data = cells[0]
                        if field == 'date' and data.text.strip() != '':
                            day = data.text.strip().replace('\n', '')
                            if date is None:
                                year = str(start_date.year)
                            else:
                                year = str(get_next_dt(date, mode='day').year)
                            try:
                                date = datetime.strptime(','.join([year, day]), '%Y,%a %b %d') \
                                    .replace(tzinfo=ff_timezone)
                            except ValueError:
                                date = datetime.strptime(','.join([year, day]), '%Y,%a%b %d') \
                                    .replace(tzinfo=ff_timezone)
                            # Fix year boundary: if parsed date is in Dec but start is in Jan, use previous year
                            if use_calendar_nav and first_date_on_page is None:
                                if date.month == 12 and start_date.month == 1:
                                    date = date.replace(year=date.year - 1)
                            # Track first and last dates on page
                            if first_date_on_page is None:
                                first_date_on_page = date
                                # Early loop detection: if first date is significantly before our start, we've looped
                                # Allow up to 7 days before start (for week boundaries)
                                # Only check after first iteration (week_count > 1)
                                if use_calendar_nav and week_count > 1 and original_start_date:
                                    days_before_start = (original_start_date - first_date_on_page).days
                                    if days_before_start > 7:  # More than a week before = definitely looped
                                        logger.info(f'Detected loop (went from {start_date.strftime("%Y-%m-%d")} back to {first_date_on_page.strftime("%Y-%m-%d")}). Scraping complete.')
                                        return
                            last_date_on_page = date
                        elif field == 'time' and data.text.strip() != '' and date is not None:
                            time_str = data.text.strip()
                            if 'Day' in time_str:
                                date = date.replace(hour=23, minute=59, second=59)
                            elif 'Data' in time_str:
                                date = date.replace(hour=0, minute=0, second=1)
                            else:
                                i = 1 if len(time_str) == 7 else 0
                                date = date.replace(
                                    hour=int(time_str[:1 + i]) % 12 + (12 * (time_str[4 + i:] == 'pm')),
                                    minute=int(time_str[2 + i:4 + i]), second=0)
                        elif field == 'currency':
                            currency = data.text.strip()
                        elif field == 'impact':
                            impact = data.find('span')['title']
                        elif field == 'event':
                            event = data.text.strip()
                        elif field == 'actual':
                            actual = data.text.strip()
                        elif field == 'forecast':
                            forecast = data.text.strip()
                        elif field == 'previous':
                            previous = data.text.strip()

                    if date is None:
                        continue
                    if date.second == 1:
                        raise ValueError

                    # For calendar nav, write all events on the page
                    # For URL mode, skip events before start_date
                    if not use_calendar_nav and date <= start_date:
                        continue

                    # Skip events past end_date
                    if date > end_date:
                        continue

                    # Skip empty rows (no event name or currency)
                    if not event or not currency:
                        continue

                    outcome = calculate_outcome(actual, forecast)
                    source_tz, source_tz_name = get_source_timezone(currency)

                    record = build_event_record(
                        dt=date,
                        currency=currency,
                        source_tz_name=source_tz_name,
                        raw_impact=impact,
                        event_name=event,
                        actual=actual,
                        forecast=forecast,
                        previous=previous,
                        outcome=outcome
                    )
                    write_jsonl_record(record)
                    rows_written += 1

                except TypeError as e:
                    logger.warning(f'TypeError at {date}: No Event Found')
                    with open('errors.csv', mode='a') as file:
                        file.write(str(date) + ' (No Event Found)\n')
                except ValueError:
                    logger.debug(f'ValueError at {date}: Data For Past Month')
                    with open('errors.csv', mode='a') as file:
                        file.write(str(date.replace(second=0)) + ' (Data For Past Month)\n')

            # Log progress
            if use_calendar_nav and first_date_on_page and last_date_on_page:
                logger.info(f'Wrote {rows_written} rows for week {first_date_on_page.strftime("%Y-%m-%d")} to {last_date_on_page.strftime("%Y-%m-%d")}')
            else:
                logger.info(f'Wrote {rows_written} rows for {date_url}')

            # Check if we've passed the end date
            if use_calendar_nav:
                # Stop if we've reached or passed the end date
                if last_date_on_page and last_date_on_page >= end_date:
                    logger.info(f'Reached end date ({end_date.strftime("%Y-%m-%d")}). Scraping complete.')
                    return
                # Also stop if we've looped back (first date is significantly before our start)
                # Allow up to 7 days before for week boundaries
                if first_date_on_page and original_start_date:
                    days_before = (original_start_date - first_date_on_page).days
                    if days_before > 7:
                        logger.info(f'Detected loop (went from {start_date.strftime("%Y-%m-%d")} back to {first_date_on_page.strftime("%Y-%m-%d")}). Scraping complete.')
                        return
                # Update start_date for year tracking in date parsing
                if last_date_on_page:
                    start_date = last_date_on_page
            else:
                if start_date > end_date:
                    logger.info(f'Reached end date ({end_date.strftime("%Y-%m-%d")}). Scraping complete.')
                    return
                start_date = get_next_dt(start_date, mode=get_mode(date_url))

            # Random delay between requests
            delay = random.uniform(1, 3)
            time.sleep(delay)

    finally:
        driver.quit()
        logger.info('Scraping session ended')


def get_start_dt(timezone):
    """Get the start datetime for the scraping. Function incremental.

    Reads the last record from the JSONL file to resume scraping from that point.

    Returns:
        datetime: The start datetime.
    """
    if path.isfile(JSONL_FILENAME):
        try:
            # Read the last line of the JSONL file
            with open(JSONL_FILENAME, 'rb') as file:
                file.seek(0, 2)  # Go to end
                file_size = file.tell()
                if file_size < 2:
                    return datetime(year=2007, month=1, day=1, hour=0, minute=0, tzinfo=timezone)

                # Find the last newline
                file.seek(-2, 2)
                while file.tell() > 0:
                    if file.read(1) == b'\n':
                        break
                    file.seek(-2, 1)

                last_line = file.readline().decode().strip()

            if last_line:
                record = json.loads(last_line)
                # Use timestamp_utc (milliseconds) to reconstruct datetime
                if 'timestamp_utc' in record:
                    timestamp_ms = record['timestamp_utc']
                    dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=TZ_UTC)
                    logger.info(f'Resuming from last record: {record.get("event_id", "unknown")}')
                    return dt
                # Fallback to datetime_utc string
                elif 'datetime_utc' in record:
                    dt_str = record['datetime_utc']
                    dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
                    return dt.replace(tzinfo=TZ_UTC)

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning(f'Could not parse last JSONL record: {e}')

    return datetime(year=2007, month=1, day=1, hour=0, minute=0, tzinfo=timezone)


def get_next_dt(date, mode):
    """Calculate the next datetime to scrape from. Based on efficiency either a day, week start or
    month start.

    Args:
        date (datetime): The current datetime.
        mode (str): The operating mode; can be 'day', 'week' or 'month'.

    Returns:
        datetime: The new datetime.
    """
    if mode == 'month':
        (year, month) = divmod(date.month, 12)
        return date.replace(year=date.year + year, month=month + 1, day=1, hour=0, minute=0)
    if mode == 'week':
        return date.replace(hour=0, minute=0) + timedelta(days=7)
    if mode == 'day':
        return date.replace(hour=0, minute=0) + timedelta(days=1)
    raise ValueError('{} is not a proper mode; please use month, week, or day.'.format(mode))


def dt_to_url(date, allow_future=True):
    """Creates an url from a datetime

    Args:
        date (datetime): The datetime.
        allow_future (bool): Whether to allow future dates.

    Returns:
        str: The url.
    """
    if dt_is_start_of_month(date) and dt_is_complete(date, mode='month'):
        return 'calendar.php?month={}'.format(dt_to_str(date, mode='month'))
    if dt_is_start_of_week(date) and dt_is_complete(date, mode='week'):
        for weekday in [date + timedelta(days=x) for x in range(7)]:
            if dt_is_start_of_month(weekday) and dt_is_complete(date, mode='month'):
                return 'calendar.php?day={}'.format(dt_to_str(date, mode='day'))
        return 'calendar.php?week={}'.format(dt_to_str(date, mode='week'))
    if dt_is_complete(date, mode='day') or dt_is_today(date):
        return 'calendar.php?day={}'.format(dt_to_str(date, mode='day'))
    # Allow future dates for scraping scheduled events
    if allow_future and date > datetime.now(tz=date.tzinfo):
        return 'calendar.php?day={}'.format(dt_to_str(date, mode='day'))
    raise ValueError('{} is not completed yet.'.format(dt_to_str(date, mode='day')))


def dt_to_str(date, mode):
    if mode == 'month':
        return date.strftime('%b.%Y').lower()
    if mode in ('week', 'day'):
        return '{d:%b}{d.day}.{d:%Y}'.format(d=date).lower()
    raise ValueError('{} is not a proper mode; please use month, week, or day.'.format(mode))


def get_mode(url):
    reg = re.compile('(?<=\\?).*(?=\\=)')
    return reg.search(url).group()


def dt_is_complete(date, mode):
    return get_next_dt(date, mode) <= datetime.now(tz=date.tzinfo)


def dt_is_start_of_week(date):
    return date.isoweekday() % 7 == 0


def dt_is_start_of_month(date):
    return date.day == 1


def dt_is_today(date):
    today = datetime.now()
    return today.year == date.year and today.month == date.month and today.day == date.day


def parse_args():
    """Parse command line arguments.

    Returns:
        argparse.Namespace: Parsed arguments.
    """
    parser = argparse.ArgumentParser(
        description='ForexFactory Calendar Scraper - Extracts economic calendar data optimized for Convex DB.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ffs.py                          # Scrape historical + future events (30 days ahead)
  python ffs.py --start-date 2024-01-01  # Start from specific date
  python ffs.py --future-only            # Only scrape future/scheduled events
  python ffs.py --days-ahead 60          # Scrape up to 60 days in the future
  python ffs.py --output my_data.jsonl   # Custom output file

Output Fields:
  - event_id: Unique ID for deduplication
  - status: "scheduled" or "released"
  - timestamp_utc: UTC milliseconds
  - scraped_at: When this record was scraped (for upsert tracking)
"""
    )
    parser.add_argument(
        '--start-date',
        type=str,
        help='Start date in YYYY-MM-DD format (default: resume from last scraped)'
    )
    parser.add_argument(
        '--days-ahead',
        type=int,
        default=30,
        help='Number of days ahead to scrape future events (default: 30)'
    )
    parser.add_argument(
        '--output', '-o',
        type=str,
        help=f'Output JSONL file path (default: {JSONL_FILENAME})'
    )
    parser.add_argument(
        '--future-only',
        action='store_true',
        help='Only scrape future/scheduled events (start from today)'
    )
    parser.add_argument(
        '--use-calendar-nav',
        action='store_true',
        help='Use calendar widget navigation instead of URL parameters (more reliable for historical data)'
    )
    return parser.parse_args()


if __name__ == '__main__':
    """Main function

    Initializes the module with CLI argument support.
    """
    args = parse_args()

    # Now outputs UTC, New York (EST/EDT), and London (GMT/BST) - all DST-aware
    scrap(
        timezone=TZ_NEW_YORK,
        start_date_override=args.start_date,
        days_ahead=args.days_ahead,
        output_file=args.output,
        future_only=args.future_only,
        use_calendar_nav=args.use_calendar_nav
    )
