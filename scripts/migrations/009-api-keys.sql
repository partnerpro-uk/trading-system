-- ═══════════════════════════════════════════════════════════════════════════════
-- API KEYS - Public API Authentication
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Key identification (prefix is public, hash is for validation)
    key_prefix VARCHAR(8) NOT NULL,           -- First 8 chars for identification (e.g., "trd_a1b2")
    key_hash VARCHAR(64) NOT NULL UNIQUE,     -- SHA-256 hash of full key

    -- Owner info
    name VARCHAR(100) NOT NULL,               -- User/app name
    email VARCHAR(255),                       -- Contact email
    description TEXT,                         -- What they're using it for

    -- Permissions & limits
    tier VARCHAR(20) DEFAULT 'free',          -- 'free', 'basic', 'pro', 'unlimited'
    rate_limit_per_minute INTEGER DEFAULT 60, -- Requests per minute
    allowed_pairs TEXT[] DEFAULT '{}',        -- Empty = all pairs allowed
    allowed_timeframes TEXT[] DEFAULT '{}',   -- Empty = all timeframes allowed

    -- Status
    is_active BOOLEAN DEFAULT true,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    total_requests BIGINT DEFAULT 0,

    -- Expiration (optional)
    expires_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys (email);

-- ═══════════════════════════════════════════════════════════════════════════════
-- API REQUEST LOG (for analytics, optional - can be disabled for performance)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_request_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),

    -- Request details
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    params JSONB,

    -- Response
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER,

    -- Metadata
    ip_address INET,
    user_agent TEXT,
    requested_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partition by month for efficient cleanup
CREATE INDEX IF NOT EXISTS idx_api_log_key_time ON api_request_log (api_key_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_log_time ON api_request_log (requested_at DESC);

-- Auto-cleanup old logs (keep 30 days)
-- Run this periodically: DELETE FROM api_request_log WHERE requested_at < NOW() - INTERVAL '30 days';

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Validate API key and return key info
CREATE OR REPLACE FUNCTION validate_api_key(p_key_hash VARCHAR)
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    tier VARCHAR,
    rate_limit_per_minute INTEGER,
    allowed_pairs TEXT[],
    allowed_timeframes TEXT[],
    is_valid BOOLEAN,
    rejection_reason TEXT
) AS $$
DECLARE
    v_key RECORD;
BEGIN
    SELECT * INTO v_key FROM api_keys ak
    WHERE ak.key_hash = p_key_hash AND ak.is_active = true;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            NULL::UUID, NULL::VARCHAR, NULL::VARCHAR, NULL::INTEGER,
            NULL::TEXT[], NULL::TEXT[], false, 'Invalid API key'::TEXT;
        RETURN;
    END IF;

    -- Check expiration
    IF v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW() THEN
        RETURN QUERY SELECT
            v_key.id, v_key.name, v_key.tier, v_key.rate_limit_per_minute,
            v_key.allowed_pairs, v_key.allowed_timeframes, false, 'API key expired'::TEXT;
        RETURN;
    END IF;

    -- Update last used
    UPDATE api_keys SET
        last_used_at = NOW(),
        total_requests = total_requests + 1
    WHERE api_keys.id = v_key.id;

    RETURN QUERY SELECT
        v_key.id, v_key.name, v_key.tier, v_key.rate_limit_per_minute,
        v_key.allowed_pairs, v_key.allowed_timeframes, true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Get API key usage stats
CREATE OR REPLACE FUNCTION get_api_key_stats(p_key_id UUID)
RETURNS TABLE (
    total_requests BIGINT,
    requests_today BIGINT,
    requests_this_hour BIGINT,
    last_used_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ak.total_requests,
        COUNT(*) FILTER (WHERE arl.requested_at > NOW() - INTERVAL '1 day') as requests_today,
        COUNT(*) FILTER (WHERE arl.requested_at > NOW() - INTERVAL '1 hour') as requests_this_hour,
        ak.last_used_at
    FROM api_keys ak
    LEFT JOIN api_request_log arl ON ak.id = arl.api_key_id
    WHERE ak.id = p_key_id
    GROUP BY ak.id, ak.total_requests, ak.last_used_at;
END;
$$ LANGUAGE plpgsql;
