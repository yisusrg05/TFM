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
    if (req.url ~ "^/license") {
        set req.backend_hint = license;
        return (pass);
    }

    if (req.url ~ "^/content") {
        set req.backend_hint = origin;
        set req.url = regsub(req.url, "^/content", "");
        return (hash);
    }

    return (synth(404, "Use /content or /license"));
}

sub vcl_backend_response {
    if (bereq.url !~ "^/license") {
        set beresp.ttl = 5m;
        set beresp.grace = 10m;
    }
}

sub vcl_deliver {
    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
}
