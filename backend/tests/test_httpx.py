"""Upstream downloads are bounded and never redirect to arbitrary hosts."""

import gzip

import httpx
import pytest

from app import services


@pytest.fixture
def upstream(monkeypatch):
    real_client = httpx.Client
    requests = []

    def install(handler):
        def respond(request):
            requests.append(request)
            return handler(request)

        def client(**kwargs):
            assert kwargs == {"timeout": 18, "follow_redirects": False, "trust_env": False}
            return real_client(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(services.httpx, "Client", client)
        return requests

    return install


@pytest.mark.parametrize("status", [301, 302, 307, 308, 404, 500])
def test_upstream_non_success_is_not_followed(upstream, status):
    requests = upstream(lambda request: httpx.Response(status, headers={"Location": "https://evil.example/"}))
    with pytest.raises(services.ApiError) as error:
        services.download("https://api.bar-rts.com/test", accept="application/json", maximum=100, label="BAR")
    assert error.value.status == 502
    assert len(requests) == 1


@pytest.mark.parametrize("claimed", [None, "2", "100000"])
def test_download_limits_actual_bytes_and_content_length(upstream, claimed):
    headers = {"Content-Length": claimed} if claimed is not None else {}
    upstream(lambda request: httpx.Response(200, headers=headers, content=b"x" * 101))
    with pytest.raises(services.ApiError, match="large"):
        services.download("https://api.bar-rts.com/test", accept="application/json", maximum=100, label="BAR")


def test_download_limits_decompressed_bytes(upstream):
    compressed = gzip.compress(b"x" * 10000)
    upstream(lambda request: httpx.Response(200, content=compressed, headers={"Content-Encoding": "gzip"}))
    with pytest.raises(services.ApiError, match="large"):
        services.download("https://api.bar-rts.com/test", accept="application/json", maximum=100, label="BAR")


def test_network_errors_become_api_errors(upstream):
    def fail(request):
        raise httpx.ConnectTimeout("offline", request=request)

    upstream(fail)
    with pytest.raises(services.ApiError) as error:
        services.fetch_replay_snapshot("a" * 32)
    assert error.value.status == 502


@pytest.mark.parametrize("body", [b"not JSON", b"\xff", b"NaN", b"[]"])
def test_replay_requires_valid_object(upstream, body):
    upstream(lambda request: httpx.Response(200, content=body))
    with pytest.raises(services.ApiError) as error:
        services.fetch_replay_snapshot("a" * 32)
    assert error.value.status == 502
