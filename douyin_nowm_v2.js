/* 抖音去水印·最高画质下载 V3 (Loon http-response)
 * 目标：保持正常自适应播放，仅把“下载地址”替换为响应中可用的最高画质无水印源。
 * 有 4K/2160p 则优先 4K；没有则使用接口实际暴露的最高档。
 */

const arg = String(typeof $argument !== "undefined" ? $argument : "");
const notify = /(?:^|[,&;\s])notify\s*=\s*true(?:$|[,&;\s])/i.test(arg) || /^true$/i.test(arg.trim());
let body = $response.body;
let changed = 0;
let bestLabel = "";

function clone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function cleanUrl(url) {
  if (typeof url !== "string") return url;
  return url
    .replace(/playwm/gi, "play")
    .replace(/([?&])watermark=1(?=(&|$))/gi, "$1watermark=0")
    .replace(/([?&])logo_name=[^&]*/gi, "$1logo_name=");
}

function cleanAddr(addr) {
  if (!addr || typeof addr !== "object") return addr;
  const out = clone(addr);
  if (Array.isArray(out.url_list)) out.url_list = out.url_list.map(cleanUrl);
  return out;
}

function addrHasUrl(addr) {
  return !!(addr && typeof addr === "object" && Array.isArray(addr.url_list) && addr.url_list.some(u => typeof u === "string" && /^https?:/i.test(u)));
}

function codecScore(sourceName, item) {
  const s = `${sourceName || ""} ${item && (item.gear_name || item.format || item.codec_type || item.video_extra || "")}`.toLowerCase();
  if (/265|hevc|h\.265/.test(s)) return 2;
  if (/264|avc|h\.264/.test(s)) return 1;
  return 0;
}

function makeCandidate(addr, item, video, sourceName) {
  if (!addrHasUrl(addr)) return null;
  const h = num(addr.height, item && item.height, video && video.height);
  const w = num(addr.width, item && item.width, video && video.width);
  const area = w * h || Math.max(w, h);
  const fps = num(item && item.FPS, item && item.fps, addr.fps, video && video.fps);
  const bitrate = num(item && item.bit_rate, item && item.bitrate, addr.bit_rate);
  const size = num(addr.data_size, item && item.data_size, video && video.data_size);
  const quality = num(item && item.quality_type, item && item.quality);
  return {
    addr,
    area,
    w,
    h,
    fps,
    bitrate,
    size,
    quality,
    codec: codecScore(sourceName, item),
    sourceName: sourceName || "unknown"
  };
}

function collectCandidates(video) {
  const out = [];
  if (!video || typeof video !== "object") return out;

  if (Array.isArray(video.bit_rate)) {
    for (const item of video.bit_rate) {
      if (!item || typeof item !== "object") continue;
      const c = makeCandidate(item.play_addr, item, video, "bit_rate");
      if (c) out.push(c);
    }
  }

  const directFields = [
    "play_addr_h265",
    "play_addr_265",
    "play_addr_h264",
    "play_addr",
    "download_addr"
  ];
  for (const key of directFields) {
    const c = makeCandidate(video[key], null, video, key);
    if (c) out.push(c);
  }

  const uniq = new Map();
  for (const c of out) {
    const url = (c.addr.url_list || []).find(u => typeof u === "string" && /^https?:/i.test(u)) || "";
    if (!url) continue;
    const old = uniq.get(url);
    if (!old || candidateScore(c) > candidateScore(old)) uniq.set(url, c);
  }
  return [...uniq.values()];
}

function candidateScore(c) {
  return c.area * 1e9 + c.fps * 1e7 + c.bitrate * 10 + c.size + c.codec;
}

function chooseBest(video) {
  const list = collectCandidates(video);
  if (!list.length) return null;

  list.sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    if (b.h !== a.h) return b.h - a.h;
    if (b.w !== a.w) return b.w - a.w;
    if (b.fps !== a.fps) return b.fps - a.fps;
    if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;
    if (b.size !== a.size) return b.size - a.size;
    if (b.codec !== a.codec) return b.codec - a.codec;
    return b.quality - a.quality;
  });
  return list[0];
}

function looksLikeAweme(obj) {
  return !!(obj && typeof obj === "object" && obj.video && typeof obj.video === "object" && (
    obj.aweme_id !== undefined || obj.desc !== undefined || obj.status || obj.video_control || obj.aweme_acl
  ));
}

function unlock(aweme) {
  if (!aweme || typeof aweme !== "object") return;

  const video = aweme.video;
  if (video && typeof video === "object") {
    const best = chooseBest(video);
    if (best && best.addr) {
      video.download_addr = cleanAddr(best.addr);
      changed++;
      const longEdge = Math.max(best.w || 0, best.h || 0);
      bestLabel = longEdge >= 3840 || best.h >= 2160 ? "4K" : (best.h ? `${best.h}p` : "最高画质");
    } else if (video.download_addr) {
      video.download_addr = cleanAddr(video.download_addr);
    }

    video.has_watermark = false;
    if ("without_watermark" in video) video.without_watermark = true;
    if ("has_download_suffix_logo_addr" in video) video.has_download_suffix_logo_addr = false;
  }

  aweme.prevent_download = false;
  aweme.download_setting = 0;
  if ("download_status" in aweme) aweme.download_status = 0;
  if ("is_prohibited" in aweme) aweme.is_prohibited = false;

  if (aweme.author && typeof aweme.author === "object") {
    aweme.author.download_setting = 0;
    if ("prevent_download" in aweme.author) aweme.author.prevent_download = false;
  }

  if (aweme.status && typeof aweme.status === "object") {
    aweme.status.allow_share = true;
    aweme.status.download_status = 0;
    if ("is_prohibited" in aweme.status) aweme.status.is_prohibited = false;
  }

  if (aweme.video_control && typeof aweme.video_control === "object") {
    Object.assign(aweme.video_control, {
      allow_download: true,
      prevent_download_type: 0,
      download_setting: 0,
      share_type: 1,
      allow_music: true,
      allow_react: true,
      allow_duet: true
    });
    if ("download_ignore_visibility" in aweme.video_control) aweme.video_control.download_ignore_visibility = true;
    if ("draft_progress_bar" in aweme.video_control) aweme.video_control.draft_progress_bar = 1;
  }

  if (aweme.aweme_acl && typeof aweme.aweme_acl === "object") {
    aweme.aweme_acl.download_general = { code: 0, show_type: 2, transcode: 3, mute: false };
    aweme.aweme_acl.download_mask_panel = { code: 0, show_type: 2 };
  }
}

function walk(root) {
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  const MAX_DEPTH = 12;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object" || depth > MAX_DEPTH || seen.has(value)) continue;
    seen.add(value);

    const isAweme = looksLikeAweme(value);
    if (isAweme) unlock(value);

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const child = value[i];
        if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
      }
      continue;
    }

    for (const key of Object.keys(value)) {
      if (key === "video" && isAweme) continue;
      const child = value[key];
      if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
    }
  }
}

try {
  const obj = JSON.parse(body);
  walk(obj);
  body = JSON.stringify(obj);
  if (notify && changed > 0) {
    $notification.post("抖音去水印", "", `已处理 ${changed} 个视频：${bestLabel || "最高画质"}下载，自适应播放保持不变`);
  }
} catch (e) {
  console.log("douyin_nowm_v3 error: " + e);
}

$done({ body });
