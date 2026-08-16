// این Worker به‌جای Pages، کل سایت کافه رو مستقیم از edge Cloudflare سرو می‌کنه.
// چون از دامنه workers.dev استفاده می‌شه (نه pages.dev)، برای مواقعی که pages.dev فیلتره مناسبه.

export default {
  async fetch(request, env) {
    // فعلاً کل درخواست‌ها مستقیم از پوشه public سرو می‌شن (HTML, CSS, JS, JSON, عکس‌ها)
    // اگه بعداً بخوای یه API route اضافه کنی (مثلاً فرم تماس)، همین‌جا قبل از خط ASSETS.fetch اضافه کن:
    //
    // const url = new URL(request.url);
    // if (url.pathname.startsWith("/api/")) {
    //   return new Response(JSON.stringify({ ok: true }), {
    //     headers: { "Content-Type": "application/json" },
    //   });
    // }

    return env.ASSETS.fetch(request);
  },
};
