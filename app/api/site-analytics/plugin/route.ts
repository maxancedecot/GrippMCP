import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSimpleZipArchive } from "../../../../src/simpleZip.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLUGIN_SLUG = "gripp-site-analytics";
const PLUGIN_ROOT = join(process.cwd(), "wordpress", PLUGIN_SLUG);

export async function GET(request: Request) {
  const dashboardUrl = new URL(request.url).origin;
  const [php, readme, tracker] = await Promise.all([
    readFile(join(PLUGIN_ROOT, "gripp-site-analytics.php"), "utf8"),
    readFile(join(PLUGIN_ROOT, "README.md"), "utf8"),
    readFile(join(PLUGIN_ROOT, "assets", "tracker.js"), "utf8")
  ]);
  const configuredPhp = replacePhpStringConstant(php, "DEFAULT_DASHBOARD_URL", dashboardUrl);
  const archive = createSimpleZipArchive([
    { path: `${PLUGIN_SLUG}/gripp-site-analytics.php`, data: configuredPhp },
    { path: `${PLUGIN_SLUG}/README.md`, data: readme },
    { path: `${PLUGIN_SLUG}/assets/tracker.js`, data: tracker }
  ]);

  return new Response(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${PLUGIN_SLUG}.zip"`,
      "Cache-Control": "no-store"
    }
  });
}

function replacePhpStringConstant(source: string, name: string, value: string) {
  const escapedValue = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const pattern = new RegExp(`private const ${name} = '[^']*';`);

  return source.replace(pattern, `private const ${name} = '${escapedValue}';`);
}
