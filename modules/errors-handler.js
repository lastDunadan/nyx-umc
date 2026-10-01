const {
  BALANCE_EXHAUSTED_REPLIES,
  RATE_LIMIT_REPLIES,
  GENERAL_ERROR_REPLIES,
  pickRandom,
} = require('./static-replies');

function getRetrySeconds(error) {
  const milliseconds = Number(error?.headers?.get?.('retry-after-ms'));
  if (Number.isFinite(milliseconds) && milliseconds > 0) {
    return Math.ceil(milliseconds / 1000);
  }

  const seconds = Number(error?.headers?.get?.('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }

  return null;
}

function makeRateLimitReply(error) {
  const retrySeconds = getRetrySeconds(error);
  const wait = retrySeconds === null ? 'chwilę' : `około ${retrySeconds} s`;

  const apiMessage = error?.error?.message ?? error?.message ?? '';
  const tpm = /\bLimit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i
    .exec(apiMessage);

  const report = [
    '[RAPORT TECHNICZNY]',
    'status: 429 | code: rate_limit_exceeded',
    `retry-after: ${retrySeconds === null ? 'nie podano' : `${retrySeconds} s`}`,
    ...(tpm
      ? [`TPM: limit ${tpm[1]} | użyte ${tpm[2]} | żądane ${tpm[3]}`]
      : []),
  ].join('\n');

  return (
    `${pickRandom(RATE_LIMIT_REPLIES).replace('{wait}', wait)}\n\n` +
    `\`\`\`text\n${report}\n\`\`\``
  );
}

async function handleConversationError(error, message) {
  const code = error?.code ?? error?.error?.code;

  console.error('[Nyx] Błąd odpowiedzi:', {
    status: error?.status,
    code,
    requestId: error?.requestID,
  });

  let content;

  if (code === 'credit_balance_exhausted') {
    content = pickRandom(BALANCE_EXHAUSTED_REPLIES);
  } else if (error?.status === 429 && code === 'rate_limit_exceeded') {
    content = makeRateLimitReply(error);
  } else {
    content = pickRandom(GENERAL_ERROR_REPLIES);
  }

  await message.reply({
    content,
    allowedMentions: { parse: [], repliedUser: false },
  }).catch((replyError) => {
    console.error('[Nyx] Nie udało się wysłać komunikatu o błędzie:', replyError);
  });
}

module.exports = handleConversationError;