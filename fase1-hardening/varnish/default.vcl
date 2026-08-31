vcl 4.1;

backend control {
    .host = "control-plane";
    .port = "8080";
}

sub vcl_recv {
    if (req.method == "OPTIONS") {
        return (synth(204));
    }

    if (req.url !~ "^/(health|auth|playback|manifest|content|license)") {
        return (synth(404, "Use /auth, /playback, /manifest, /content, /license or /health"));
    }

    if ((req.url ~ "^/manifest" || req.url ~ "^/content" || req.url ~ "^/license" || req.url ~ "^/playback/(heartbeat|stop)") && !req.http.Authorization) {
        return (synth(401, "Missing Authorization header"));
    }

    # Varnish es el unico proxy de entrada del laboratorio. Se reemplaza cualquier
    # valor aportado por el cliente para que el control-plane reciba una IP fiable.
    set req.http.X-Forwarded-For = client.ip;
    set req.backend_hint = control;
    set req.http.X-Forwarded-Proto = "http";
    set req.http.X-Request-Id = req.xid;

    return (pass);
}

sub vcl_synth {
    if (req.http.Origin == "http://localhost:9300" || req.http.Origin == "http://localhost:9301") {
        set resp.http.Access-Control-Allow-Origin = req.http.Origin;
    } else {
        set resp.http.Access-Control-Allow-Origin = "http://localhost:9300";
    }
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range, X-Playback-Session-Id, X-Device-Id, X-Client-Instance-Id";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Request-Id, X-Playback-Session-Id";
    set resp.http.Access-Control-Max-Age = "600";
    set resp.http.X-Request-Id = req.xid;

    return (deliver);
}

sub vcl_deliver {
    if (req.http.Origin == "http://localhost:9300" || req.http.Origin == "http://localhost:9301") {
        set resp.http.Access-Control-Allow-Origin = req.http.Origin;
    } else {
        set resp.http.Access-Control-Allow-Origin = "http://localhost:9300";
    }
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range, X-Playback-Session-Id, X-Device-Id, X-Client-Instance-Id";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Request-Id, X-Playback-Session-Id";
    set resp.http.X-Request-Id = req.xid;
    set resp.http.Cache-Control = "no-store";
}
