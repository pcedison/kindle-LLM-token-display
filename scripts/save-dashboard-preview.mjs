import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const dashboardUrl = process.argv[2] || process.env.DASHBOARD_PREVIEW_URL;

class PreviewError extends Error {}

async function savePreview() {
  if (!dashboardUrl) {
    throw new PreviewError('Supply a dashboard URL as the first argument or DASHBOARD_PREVIEW_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(dashboardUrl);
  } catch {
    throw new PreviewError('Dashboard preview URL is invalid');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new PreviewError('Dashboard preview URL must use HTTP or HTTPS');
  }

  let response;
  try {
    response = await fetch(parsedUrl, { cache: 'no-store' });
  } catch {
    throw new PreviewError('Dashboard preview request failed');
  }
  if (response.status !== 200) {
    throw new PreviewError(`Dashboard preview request failed with HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new PreviewError('Dashboard preview response is not a PNG');
  }

  const outputDirectory = path.resolve('artifacts');
  const outputPath = path.join(outputDirectory, 'dashboard-dp75sdi.png');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, bytes);

  console.log(`Saved ${bytes.length} bytes to ${outputPath}`);
}

try {
  await savePreview();
} catch (error) {
  console.error(error instanceof PreviewError ? error.message : 'Dashboard preview failed');
  process.exitCode = 1;
}
