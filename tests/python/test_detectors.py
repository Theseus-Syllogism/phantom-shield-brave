from phantom_shield.detectors import (
    detect_block,
    cloudflare,
    akamai,
    perimeterx,
    recaptcha,
    hcaptcha,
    rate_limited,
    generic_403,
)


def test_cloudflare_via_cf_mitigated_header():
    sig = cloudflare(403, {"cf-mitigated": "challenge"}, "")
    assert sig is not None
    assert sig.detector == "cloudflare"


def test_cloudflare_challenge_page_body():
    sig = cloudflare(503, {"cf-ray": "abc"}, "<html>Checking your browser before access...</html>")
    assert sig is not None


def test_cloudflare_attention_required():
    sig = cloudflare(403, {"cf-ray": "xyz"}, "Attention Required! Cloudflare ...")
    assert sig is not None


def test_cloudflare_clean_200_not_blocked():
    assert cloudflare(200, {"cf-ray": "abc"}, "<html><body>real content</body></html>") is None


def test_akamai_request_id_with_403():
    sig = akamai(403, {"x-akamai-request-id": "1"}, "")
    assert sig is not None


def test_akamai_reference_number_body():
    sig = akamai(403, {}, "akamai blocked. Reference Number: 18.abcdef")
    assert sig is not None


def test_perimeterx_block_header():
    sig = perimeterx(403, {"x-px-block": "1"}, "")
    assert sig is not None


def test_perimeterx_body_markers():
    sig = perimeterx(403, {}, "<script src='//client.perimeterx.net/...'>")
    assert sig is not None


def test_recaptcha_challenge():
    sig = recaptcha(429, {}, "<div class='g-recaptcha'></div>")
    assert sig is not None


def test_hcaptcha_challenge():
    sig = hcaptcha(403, {}, '<div class="h-captcha"></div>')
    assert sig is not None


def test_rate_limited_detects_429():
    sig = rate_limited(429, {"retry-after": "30"}, "")
    assert sig is not None
    assert "30" in sig.reason


def test_generic_403_with_keyword():
    sig = generic_403(403, {}, "Access Denied. Please try again.")
    assert sig is not None


def test_generic_403_clean_403_not_keyworded_skips():
    # 403 with no keyword: don't fire generic detector (low FP rate).
    assert generic_403(403, {}, "<html><title>Profile</title></html>") is None


def test_detect_block_runs_all_when_unspecified():
    signals = detect_block(429, {"retry-after": "5"}, "")
    detectors_fired = {s.detector for s in signals}
    assert "rate_limit" in detectors_fired


def test_detect_block_restricts_to_selected():
    signals = detect_block(429, {"retry-after": "5"}, "", detectors=["cloudflare"])
    assert signals == []  # cloudflare didn't fire on a plain 429


def test_detect_block_aggregates_multiple_signals():
    body = '<script src="cloudflare-challenge"></script><div class="g-recaptcha">'
    signals = detect_block(
        403,
        {"cf-mitigated": "challenge"},
        body + "__cf_chl_",
        detectors=["cloudflare", "recaptcha"],
    )
    detectors_fired = {s.detector for s in signals}
    assert "cloudflare" in detectors_fired
