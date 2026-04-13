vcl 4.1;

backend control {
    .host = "control-plane";
    .port = "8080";
}

sub vcl_recv {
    if (req.method == "OPTIONS") {
        return (synth(204));
    }

    if (req.url !~ "^/(health|auth|playback|content|license|admin)") {
        return (synth(404, "Use /auth, /playback, /content, /license, /admin or /health"));
    }

    if ((req.url ~ "^/content" || req.url ~ "^/license" || req.url ~ "^/playback/(heartbeat|stop)" || req.url ~ "^/admin") && !req.http.Authorization) {
        return (synth(401, "Missing Authorization header"));
    }

    set req.backend_hint = control;
    set req.http.X-Forwarded-Proto = "http";
    set req.http.X-Request-Id = req.xid;

    return (pass);
}

sub vcl_synth {
    set resp.http.Access-Control-Allow-Origin = "http://localhost:9400";
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range, X-Playback-Session-Id, X-Device-Id";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Request-Id";
    set resp.http.Access-Control-Max-Age = "600";
    set resp.http.X-Request-Id = req.xid;
    return (deliver);
}

sub vcl_deliver {
    set resp.http.Access-Control-Allow-Origin = "http://localhost:9400";
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range, X-Playback-Session-Id, X-Device-Id";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Request-Id";
    set resp.http.X-Request-Id = req.xid;
    set resp.http.Cache-Control = "no-store";
}
