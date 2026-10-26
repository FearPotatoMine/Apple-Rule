/* 抖音去水印·最高画质下载 V2 (Loon http-response)
 * 目标：保持抖音正常自适应播放，仅把“下载地址”替换为最高画质可用播放源。
 */

const arg = String(typeof $argument !== "undefined" ? $argument : "");
const notify = /(?:^|[,&;\s])notify\s*=\s*true(?:$|[,&;\s])/i.test(arg) || /^true$/i.test(arg.trim());
let body = $response.body;
let changed = 0;

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

function rankVariant(item, video) {
  const addr = item && item.play_addr;
  const h = num(addr && addr.height, item && item.height, video && video.height);
  const w = num(addr && addr.width, item && item.width, video && video.width);
  const area = h * w || h;
  const fps = num(item && item.FPS, item && item.fps, addr && addr.fps);
  const bitrate = num(item && item.bit_rate, item && item.bitrate);
  const size = num(addr && addr.data_size, item && item.data_size);
  return { area, h, w, fps, bitrate, size };
}

function bestDownload(video) {
  if (!video || !Array.isArray(video.bit_rate)) return null;
  const list = video.bit_rate.filter(item =>
    item && item.play_addr && Array.isArray(item.play_addr.url_list) && item.play_addr.url_list.length
  );
  if (!list.length) return null;

  list.sort((a, b) => {
    const A = rankVariant(a, video);
    const B = rankVariant(b, video);
    if (B.area !== A.area) return B.area - A.area;
    if (B.fps !== A.fps) return B.fps - A.fps;
    if (B.bitrate !== A.bitrate) return B.bitrate - A.bitrate;
    return B.size - A.size;
  });
  return list[0];
}

function cleanUrl(url) {
  if (typeof url !== "string") return url;
  return url
    .replace(/playwm/gi, "play")
    .replace(/([?&])watermark=1(?=(&|$))/gi, "$1watermark=0");
}

function cleanAddr(addr) {
  if (!addr || typeof addr !== "object") return addr;
  const out = clone(addr);
  if (Array.isArray(out.url_list)) out.url_list = out.url_list.map(cleanUrl);
  return out;
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
    const best = bestDownload(video);
    if (best && best.play_addr) {
      // 只替换下载地址；不覆盖 video.play_addr，避免破坏自适应播放。
      video.download_addr = cleanAddr(best.play_addr);
      changed++;
    } else if (video.download_addr) {
      // 没有 bit_rate 时，只对现有下载 URL 做兼容性清理。
      video.download_addr = cleanAddr(video.download_addr);
    }
    video.has_watermark = false;
  }

  aweme.prevent_download = false;
  aweme.download_setting = 0;

  if (aweme.status && typeof aweme.status === "object") {
    aweme.status.allow_share = true;
    aweme.status.download_status = 0;
  }

  if (aweme.video_control && typeof aweme.video_control === "object") {
    Object.assign(aweme.video_control, {
      allow_download: true,
      prevent_download_type: 0,
      download_setting: 0,
      share_type: 1
    });
    if ("download_ignore_visibility" in aweme.video_control) {
      aweme.video_control.download_ignore_visibility = true;
    }
  }

  if (aweme.aweme_acl && typeof aweme.aweme_acl === "object") {
    aweme.aweme_acl.download_general = { code: 0, show_type: 2, transcode: 3, mute: false };
    if (aweme.aweme_acl.download_mask_panel) {
      aweme.aweme_acl.download_mask_panel = { code: 0, show_type: 2 };
    }
  }
}

function walk(root) {
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  const MAX_DEPTH = 10;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object" || depth > MAX_DEPTH || seen.has(value)) continue;
    seen.add(value);

    if (looksLikeAweme(value)) unlock(value);

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const child = value[i];
        if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
      }
      continue;
    }

    for (const key of Object.keys(value)) {
      // aweme.video 内部结构很深且无需继续递归，跳过可减少开销。
      if (key === "video" && looksLikeAweme(value)) continue;
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
    $notification.post("抖音去水印", "", `已处理 ${changed} 个视频：最高画质下载，自适应播放保持不变`);
  }
} catch (e) {
  console.log("douyin_nowm_v2 error: " + e);
}

$done({ body });
