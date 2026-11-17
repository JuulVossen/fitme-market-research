// Preserve existing shared /?run=<id> links after introducing the section home.
const legacyUrl = new URL(window.location.href);
if (legacyUrl.searchParams.has('run')) {
  const target = new URL('vertical-network-synergy/', legacyUrl);
  target.search = legacyUrl.search;
  target.hash = legacyUrl.hash;
  window.location.replace(target.href);
}
