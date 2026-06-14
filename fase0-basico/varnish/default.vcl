vcl 4.1;

backend origin {
    .host = "origin";
    .port = "80";
}

backend license {
    .host = "license-server";
    .port = "8080";
}

sub vcl_recv {
    if (req.method == "OPTIONS") {
        return (synth(204));
    }

    if (req.url ~ "^/license" || req.url ~ "^/platform/license" || req.url ~ "^/auth") {
        set req.backend_hint = license;
        return (pass);
    }

    if (req.url ~ "^/content") {
        set req.backend_hint = origin;
        set req.url = regsub(req.url, "^/content", "");
        return (hash);
    }

    return (synth(404, "Use /content, /license, /auth or /platform/license"));
}

sub vcl_backend_response {
    if (bereq.url ~ "^/license" || bereq.url ~ "^/platform/license" || bereq.url ~ "^/auth") {
        set beresp.uncacheable = true;
        set beresp.ttl = 0s;
        set beresp.http.Cache-Control = "no-store";
    } else {
        set beresp.ttl = 5m;
        set beresp.grace = 10m;
    }
}

sub vcl_synth {
    set resp.http.Access-Control-Allow-Origin = "*";
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Cache, X-Phase0-Weakness, X-Upstream-License-Server";
    set resp.http.Access-Control-Max-Age = "86400";

    return (deliver);
}

sub vcl_deliver {
    set resp.http.Access-Control-Allow-Origin = "*";
    set resp.http.Access-Control-Allow-Methods = "GET, HEAD, OPTIONS, POST";
    set resp.http.Access-Control-Allow-Headers = "Authorization, Content-Type, Range";
    set resp.http.Access-Control-Expose-Headers = "Content-Length, Content-Range, Accept-Ranges, X-Cache, X-Phase0-Weakness, X-Upstream-License-Server";

    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
}
