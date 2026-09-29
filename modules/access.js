function hasAiAccess(message) {
  const roleId = process.env.AI_ACCESS_ROLE_ID;
  return Boolean(
    roleId &&
    message.guild &&
    !message.author.bot &&
    message.member?.roles.cache.has(roleId)
  );
}

module.exports = { hasAiAccess };
