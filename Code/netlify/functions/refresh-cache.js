exports.handler = async () => {
  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK_URL;

  if (!buildHookUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'NETLIFY_BUILD_HOOK_URL is not configured' }),
    };
  }

  const response = await fetch(buildHookUrl, { method: 'POST' });

  return {
    statusCode: response.ok ? 200 : 502,
    body: JSON.stringify({
      triggered: response.ok,
      status: response.status,
    }),
  };
};
