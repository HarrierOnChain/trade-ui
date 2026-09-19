/** Route shell only. The token UI is mounted by ClientPages from the URL so
 *  opening `/token/{chain}/{address}` does not wait on a heavy client page
 *  chunk (those `[...parts]` URLs are routinely broken by local proxies). */
export default function TokenPage() {
  return null;
}
