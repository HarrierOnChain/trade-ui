/**
 * Next.js dev logs every request as one stdout line
 * (" GET /path 200 in 12ms"). The config can ignore URLs, not statuses, so
 * 200s are dropped here and 4xx/5xx stay.
 */
const OK_REQUEST = /^ (?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \S+ (?:\x1b\[32m)?200(?:\x1b\[39m)? in \d+ms\n$/;

export function isOkRequestLog(chunk) {
  const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : "";
  return OK_REQUEST.test(text);
}

export function silenceOkRequestLogs() {
  const write = process.stdout.write;
  process.stdout.write = function (chunk, encoding, cb) {
    if (isOkRequestLog(chunk)) {
      const done = typeof encoding === "function" ? encoding : cb;
      if (typeof done === "function") done();
      return true;
    }
    return write.call(process.stdout, chunk, encoding, cb);
  };
}
