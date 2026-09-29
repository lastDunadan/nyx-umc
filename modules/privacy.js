const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?<![\p{L}\p{N}])(?:\+?48[\s.-]?)?(?:\d[\s.-]?){8}\d(?!\d)/u;
const POSTCODE = /\b\d{2}-\d{3}\b/;
const ADDRESS =
  /\b(?:ul(?:ica)?\.?|al(?:eja)?\.?|os(?:iedle)?\.?|pl(?:ac)?\.?)\s+[^\n,]{2,80}\s+\d{1,4}[A-Za-z]?(?:\/\d{1,4})?\b/iu;

function canStoreExchange(content, response, containsPersonalData) {
  if (containsPersonalData !== false) return false;

  const text = `${content}\n${response}`;
  return ![EMAIL, PHONE, POSTCODE, ADDRESS].some((pattern) => pattern.test(text));
}

module.exports = { canStoreExchange };