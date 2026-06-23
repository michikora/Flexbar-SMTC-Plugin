const { plugin, logger, pluginPath, resourcesPath } = require("@eniac/flexdesigner");
const { 
    SMTCMonitor, PlaybackStatus, 
    tryPlay, tryPause, tryTogglePlayPause, trySkipNext, trySkipPrevious, 
    tryChangeShuffleActive, tryChangeAutoRepeatMode 
} = require("@coooookies/windows-smtc-monitor");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { Vibrant } = require("node-vibrant/node");
const { Worker } = require("worker_threads");

let currentAppVolume = 100;
let mixerWorker = null;

function initMixerWorker() {
    if (mixerWorker) return;
    const workerCode = `
    const { parentPort, workerData } = require('worker_threads');
    const path = require('path');
    
    let SoundMixer;
    try {
        const addonPath = path.join(workerData.dirname, 'addons', 'win-sound-mixer.node');
        SoundMixer = require(addonPath).SoundMixer;
    } catch(e) {
        try {
            const mod = require('native-sound-mixer');
            SoundMixer = mod.default || mod.SoundMixer || mod;
        } catch(err) {}
    }
    
    let currentAppId = null;
    
    function updateTarget(appId) {
        currentAppId = appId;
    }

    function isSessionMatch(session) {
        if (!currentAppId) return false;
        
        let searchName = currentAppId.toLowerCase();
        if (searchName.includes('!')) searchName = searchName.split('!')[1];
        searchName = searchName.replace('.exe', '');
        
        const sName = (session.name || '').toLowerCase();
        const sAppName = (session.appName || '').toLowerCase();
        
        if (sName && sName.includes(searchName)) return true;
        if (sAppName && sAppName.includes(searchName)) return true;
        
        return false;
    }
    
    parentPort.on('message', (msg) => {
        if (!SoundMixer) return;
        if (msg.type === 'updateTarget') {
            updateTarget(msg.appId);
        } else if (msg.type === 'setVolume') {
            try {
                let sessions = SoundMixer.sessions || [];
                if (sessions.length === 0) {
                    for (const device of SoundMixer.devices) sessions = sessions.concat(device.sessions);
                }
                for (const session of sessions) {
                    if (isSessionMatch(session)) {
                        session.volume = msg.volume;
                        session.mute = false;
                    }
                }
            } catch(e) {}
        }
    });
    
    setInterval(() => {
        if (!SoundMixer || !currentAppId) return;
        try {
            let sessions = SoundMixer.sessions || [];
            if (sessions.length === 0) {
                for (const device of SoundMixer.devices) sessions = sessions.concat(device.sessions);
            }
            for (const session of sessions) {
                if (isSessionMatch(session)) {
                    parentPort.postMessage({
                        type: 'volumeUpdate',
                        volume: Math.round(session.volume * 100)
                    });
                    return;
                }
            }
        } catch(e) {}
    }, 500);
    `;
    
    mixerWorker = new Worker(workerCode, { 
        eval: true,
        workerData: { dirname: __dirname }
    });
    
    mixerWorker.on('message', (msg) => {
        if (msg.type === 'volumeUpdate') {
            if (msg.volume !== currentAppVolume) {
                currentAppVolume = msg.volume;
                requestRefreshAllKeys();
            }
        }
    });
}

let monitor = null;
let currentAppId = null;

let currentMedia = null;
let currentTimeline = { position: 0, duration: 0 };
let currentPlayback = { playbackStatus: PlaybackStatus.CLOSED, playbackType: 0 };

let lastSyncTime = Date.now();

// Cache for cover art and colors
let currentThumbnailBuffer = null;
let currentCoverImage = null; // Canvas Image object
let currentPalette = {
    bg: '#000000',
    progressFill: '#1DB954',
    progressBg: '#404040',
    textMain: '#FFFFFF',
    textSub: '#B3B3B3'
};

// Track flexbar keys
// Structure: { [serialNumber]: { [uid]: keyObject } }
const activeKeys = {};

let progressInterval = null;
let clearStateTimeout = null;

function startProgressInterval() {
    if (progressInterval) return;
    progressInterval = setInterval(() => {
        if (currentPlayback.playbackStatus === PlaybackStatus.PLAYING) {
            const now = Date.now();
            const dt = (now - lastSyncTime) / 1000;
            lastSyncTime = now;
            
            currentTimeline.position += dt;
            if (currentTimeline.position > currentTimeline.duration) {
                currentTimeline.position = currentTimeline.duration; // Cap it
            }
            
            refreshAllKeys();
        } else {
            lastSyncTime = Date.now();
        }
    }, 1000);
}

function stopProgressInterval() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

// Start interval immediately
startProgressInterval();

// --- Graceful Shutdown ---
function cleanup() {
    stopProgressInterval();
    if (monitor) {
        monitor.destroy(); // Clean up native SMTC monitor if it supports it
        monitor = null;
    }
    if (mixerWorker) {
        mixerWorker.terminate();
        mixerWorker = null;
    }
}

process.on('SIGINT', () => {
    logger.info('[Plugin] Received SIGINT, cleaning up...');
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('[Plugin] Received SIGTERM, cleaning up...');
    cleanup();
    process.exit(0);
});

// --- Initialization ---

plugin.start();

plugin.on('plugin.alive', (payload) => {
    const { serialNumber, keys } = payload;
    if (!activeKeys[serialNumber]) activeKeys[serialNumber] = {};
    
    keys.forEach(key => {
        activeKeys[serialNumber][key.uid] = key;
        
        if (key.cid === 'com.michikora.smtcplugin.nowplaying') {
            drawNowPlaying(serialNumber, key);
        }
    });

    requestRefreshAllKeys();

    if (!monitor) {
        initMixerWorker();
        initSMTC();
    }
});

plugin.on('plugin.dead', (payload) => {
    const { serialNumber, keys } = payload;
    if (activeKeys[serialNumber]) {
        keys.forEach(key => {
            delete activeKeys[serialNumber][key.uid];
        });
    }
});

plugin.on('plugin.config.updated', (payload) => {
    const { serialNumber, keys } = payload;
    if (activeKeys[serialNumber]) {
        keys.forEach(key => {
            activeKeys[serialNumber][key.uid] = key;
        });
    }
    refreshAllKeys();
});

// --- SMTC Logic ---

function initSMTC() {
    try {
        monitor = new SMTCMonitor();
        
        // Load initial state
        const initialSession = SMTCMonitor.getCurrentMediaSession();
        if (initialSession) {
            currentAppId = initialSession.sourceAppId;
            updateMediaState(initialSession);
            if (mixerWorker) {
                mixerWorker.postMessage({ type: 'updateTarget', appId: currentAppId });
            }
        }

        monitor.on('current-session-changed', (sourceAppId) => {
            let isSameApp = (currentAppId === sourceAppId);
            currentAppId = sourceAppId;
            if (mixerWorker) {
                mixerWorker.postMessage({ type: 'updateTarget', appId: sourceAppId });
            }
            if (sourceAppId) {
                if (clearStateTimeout) {
                    clearTimeout(clearStateTimeout);
                    clearStateTimeout = null;
                }
                const session = SMTCMonitor.getMediaSessionByAppId(sourceAppId);
                if (session) updateMediaState(session, isSameApp);
            } else {
                if (clearStateTimeout) clearTimeout(clearStateTimeout);
                clearStateTimeout = setTimeout(() => {
                    clearMediaState();
                    clearStateTimeout = null;
                }, 1000);
            }
        });

        monitor.on('session-media-changed', (sourceAppId, mediaProps) => {
            if (sourceAppId === currentAppId) {
                if (!mediaProps || !mediaProps.title) {
                    return; // Shield: Ignore empty media updates for the current app to prevent flashing
                }
                currentMedia = mediaProps;
                processNewCoverArt(mediaProps.thumbnail);
            }
        });

        monitor.on('session-timeline-changed', (sourceAppId, timelineProps) => {
            if (sourceAppId === currentAppId) {
                const isTicks = timelineProps.duration > 1000000;
                currentTimeline = {
                    position: isTicks ? timelineProps.position / 10000000 : timelineProps.position,
                    duration: isTicks ? timelineProps.duration / 10000000 : timelineProps.duration
                };
                lastSyncTime = Date.now();
                requestRefreshAllKeys();
            }
        });

        monitor.on('session-playback-changed', (sourceAppId, playbackInfo) => {
            if (sourceAppId !== currentAppId && playbackInfo.playbackStatus === PlaybackStatus.PLAYING) {
                currentAppId = sourceAppId;
                if (mixerWorker) {
                    mixerWorker.postMessage({ type: 'updateTarget', appId: sourceAppId });
                }
                const session = SMTCMonitor.getMediaSessionByAppId(sourceAppId);
                if (session) updateMediaState(session);
                return;
            }

            if (sourceAppId === currentAppId) {
                if (playbackInfo.playbackStatus === PlaybackStatus.CLOSED || playbackInfo.playbackStatus === PlaybackStatus.STOPPED) {
                    if (clearStateTimeout) clearTimeout(clearStateTimeout);
                    clearStateTimeout = setTimeout(() => {
                        currentPlayback = playbackInfo;
                        clearMediaState();
                        clearStateTimeout = null;
                    }, 1000);
                } else {
                    currentPlayback = playbackInfo;
                    lastSyncTime = Date.now();
                    if (clearStateTimeout) {
                        clearTimeout(clearStateTimeout);
                        clearStateTimeout = null;
                    }
                    requestRefreshAllKeys();
                }
            }
        });

        monitor.on('session-removed', (sourceAppId) => {
            if (sourceAppId === currentAppId) {
                if (clearStateTimeout) clearTimeout(clearStateTimeout);
                clearStateTimeout = setTimeout(() => {
                    clearMediaState();
                    clearStateTimeout = null;
                }, 1000);
            }
        });
        
        logger.info("SMTC Monitor initialized successfully.");
    } catch (err) {
        logger.error("Failed to initialize SMTC Monitor:");
        logger.error(err);
    }
}

function updateMediaState(session, isSameApp = false) {
    if (isSameApp && (!session.media || !session.media.title)) {
        currentPlayback = session.playback;
        
        const isTicks = session.timeline && session.timeline.duration > 1000000;
        currentTimeline = {
            position: isTicks ? session.timeline.position / 10000000 : (session.timeline?.position || 0),
            duration: isTicks ? session.timeline.duration / 10000000 : (session.timeline?.duration || 0)
        };
        lastSyncTime = Date.now();
        requestRefreshAllKeys();
        return;
    }

    currentMedia = session.media;
    currentPlayback = session.playback;
    
    const isTicks = session.timeline && session.timeline.duration > 1000000;
    currentTimeline = {
        position: isTicks ? session.timeline.position / 10000000 : (session.timeline?.position || 0),
        duration: isTicks ? session.timeline.duration / 10000000 : (session.timeline?.duration || 0)
    };
    lastSyncTime = Date.now();

    processNewCoverArt(session.media.thumbnail);
}

function clearMediaState() {
    currentMedia = null;
    currentThumbnailBuffer = null;
    currentCoverImage = null;
    currentPlayback.playbackStatus = PlaybackStatus.CLOSED;
    requestRefreshAllKeys();
}

async function processNewCoverArt(thumbnailBuffer) {
    if (!thumbnailBuffer) {
        currentThumbnailBuffer = null;
        currentCoverImage = null;
        useDefaultPalette();
        requestRefreshAllKeys();
        return;
    }
    
    // Check if it's the exact same buffer to avoid re-processing
    if (currentThumbnailBuffer && Buffer.compare(currentThumbnailBuffer, thumbnailBuffer) === 0) {
        requestRefreshAllKeys();
        return;
    }

    currentThumbnailBuffer = thumbnailBuffer;
    
    try {
        currentCoverImage = await loadImage(thumbnailBuffer);
        
        // Extract colors
        const palette = await Vibrant.from(thumbnailBuffer).getPalette();
        if (palette) {
            const rawBg = palette.DarkMuted ? palette.DarkMuted.hex : '#222222';
            const rawProgressFill = palette.Vibrant ? palette.Vibrant.hex : '#1DB954';
            const rawProgressBg = palette.Muted ? palette.Muted.hex : '#555555';
            const rawTextMain = palette.LightVibrant ? palette.LightVibrant.hex : '#FFFFFF';
            const rawTextSub = palette.LightMuted ? palette.LightMuted.hex : '#CCCCCC';

            currentPalette = {
                bg: rawBg,
                progressFill: ensureContrast(rawProgressFill, rawBg, 3.0),
                progressBg: ensureContrast(rawProgressBg, rawBg, 2.0),
                textMain: ensureContrast(rawTextMain, rawBg, 4.5),
                textSub: ensureContrast(rawTextSub, rawBg, 4.5)
            };
        } else {
            useDefaultPalette();
        }
    } catch (err) {
        logger.error("Failed to process cover art:");
        logger.error(err);
        currentCoverImage = null;
        useDefaultPalette();
    }
    
    requestRefreshAllKeys();
}

function useDefaultPalette() {
    currentPalette = {
        bg: '#000000',
        progressFill: '#FFFFFF',
        progressBg: '#707070',
        textMain: '#FFFFFF',
        textSub: '#A0A0A0'
    };
}

function drawPlaceholderIcon(ctx, x, y, size, color) {
    ctx.save();
    const scale = size / 24;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    
    ctx.beginPath();
    // Outer circle (Radius 8, Center 12,12)
    ctx.arc(12, 12, 8, 0, Math.PI * 2, false);
    // Inner cutout (Radius 2, Center 12,12). Drawn counter-clockwise to create a hole.
    ctx.arc(12, 12, 2, Math.PI * 2, 0, true);
    ctx.fill();
    
    ctx.restore();
}

// --- Drawing Logic ---

let refreshTimeout = null;
function requestRefreshAllKeys() {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
        refreshAllKeys();
    }, 50);
}

function refreshAllKeys() {
    Object.keys(activeKeys).forEach(sn => {
        Object.values(activeKeys[sn]).forEach(key => {
            if (key.cid === 'com.michikora.smtcplugin.nowplaying') {
                drawNowPlaying(sn, key);
            } else if (key.cid === 'com.michikora.smtcplugin.previous' || key.cid === 'com.michikora.smtcplugin.next') {
                // Native single-state keys, no special handling needed
            } else if (key.cid === 'com.michikora.smtcplugin.playpause') {
                const isClosed = !currentMedia || !currentMedia.title || currentPlayback.playbackStatus === PlaybackStatus.CLOSED;
                let stateIndex = 0; // State 0 (Closed)
                if (!isClosed) {
                    const isPlaying = currentPlayback.playbackStatus === PlaybackStatus.PLAYING;
                    stateIndex = isPlaying ? 2 : 1; // State 2 (Playing), State 1 (Paused)
                }
                plugin.setMultiState(sn, key, stateIndex).catch(()=>{});
            } else if (key.cid === 'com.michikora.smtcplugin.shuffle') {
                const isClosed = !currentMedia || !currentMedia.title || currentPlayback.playbackStatus === PlaybackStatus.CLOSED;
                const isUnsupported = currentPlayback.isShuffleActive === undefined;
                let stateIndex = 0; // State 0 (Closed / Unsupported)
                if (!isClosed && !isUnsupported) {
                    const isActive = currentPlayback.isShuffleActive === true;
                    stateIndex = isActive ? 2 : 1; // State 2 (Active), State 1 (Inactive)
                }
                plugin.setMultiState(sn, key, stateIndex).catch(()=>{});
            } else if (key.cid === 'com.michikora.smtcplugin.loop') {
                const isClosed = !currentMedia || !currentMedia.title || currentPlayback.playbackStatus === PlaybackStatus.CLOSED;
                const isUnsupported = currentPlayback.autoRepeatMode === undefined;
                let stateIndex = 0; // State 0 (Closed / Unsupported)
                if (!isClosed && !isUnsupported) {
                    const mode = currentPlayback.autoRepeatMode;
                    if (mode === 2) stateIndex = 2; // List
                    else if (mode === 1) stateIndex = 3; // Track
                    else stateIndex = 1; // None
                }
                plugin.setMultiState(sn, key, stateIndex).catch(()=>{});
            } else if (key.cid === 'com.michikora.smtcplugin.volume') {
                const isClosed = !currentMedia || !currentMedia.title || currentPlayback.playbackStatus === PlaybackStatus.CLOSED;
                if (!isClosed) {
                    plugin.setSlider(sn, key, currentAppVolume).catch(()=>{});
                } else {
                    plugin.setSlider(sn, key, 0).catch(()=>{});
                }
            }
        });
    });
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function drawNowPlaying(serialNumber, key) {
    // If no media is playing or SMTC is closed, revert to default FlexDesigner look
    if (!currentMedia || !currentMedia.title || currentPlayback.playbackStatus === PlaybackStatus.CLOSED) {
        const fallbackKey = JSON.parse(JSON.stringify(key));
        fallbackKey.style.showImage = false;
        fallbackKey.style.image = undefined;
        // Respect the user's native settings for icon and title visibility.
        // Explicitly true if not explicitly false, to prevent canvas cache bugs.
        fallbackKey.style.showIcon = key.style.showIcon !== false;
        fallbackKey.style.showTitle = key.style.showTitle !== false;
        plugin.draw(serialNumber, fallbackKey, 'draw').catch(err => logger.error("Fallback draw failed", err));
        return;
    }

    const width = key.style.width || 600;
    const height = 60; // Standard flexbar key height
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // User preferences (fallback to auto)
    const useAutoBg = key.data?.autoBgColor !== false;
    const useAutoProgress = key.data?.autoProgressFillColor !== false;
    const useAutoText = key.data?.autoTextColor !== false;
    
    // Fonts - Prioritize neutral OS UI fonts, fallback explicitly to CJK to prevent Node-Canvas "tofu" (square boxes)
    const defaultFontStack = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, "Meiryo", "Microsoft YaHei", "PingFang SC", sans-serif';
    const fontMain = key.data?.fontMain || defaultFontStack;
    const fontTime = key.data?.fontTime || defaultFontStack;

    // 1. Background
    const nativeBg = key.style?.bgColor || '#000000';
    const bgColor = useAutoBg 
        ? (currentCoverImage ? currentPalette.bg : nativeBg) 
        : (key.data?.manualBgColor || nativeBg);
    
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const paddingX = 5;
    const paddingY = 5;
    
    // Define layout modes based on width
    const isMicroMode = width <= 60;
    const isMiniMode = width > 60 && width <= 120;
    const isCompactMode = width > 120 && width <= 180;

    const nativeFg = key.style?.fgColor || '#FFFFFF';
    
    // Main Text & Progress Fill Colors
    const mainColor = useAutoText 
        ? (currentCoverImage ? currentPalette.textMain : nativeFg) 
        : (key.data?.manualTextColor || nativeFg);
        
    const progressFillColor = useAutoProgress 
        ? (currentCoverImage ? currentPalette.progressFill : nativeFg) 
        : (key.data?.manualProgressFillColor || nativeFg);
    
    // Sub Text & Progress Background Colors (Blend with bgColor if no palette)
    const subColor = (useAutoText && currentCoverImage)
        ? currentPalette.textSub 
        : blendColors(mainColor, bgColor, 0.65);
    
    const progressBgColor = (useAutoProgress && currentCoverImage)
        ? currentPalette.progressBg 
        : (key.data?.manualProgressBgColor || blendColors(progressFillColor, bgColor, 0.30));

    // Helper for drawing faded text
    const drawFadedText = (text, x, y, maxW, fontStr, color, heightSize, fadeW, centerIfFits = false) => {
        if (maxW <= 0) return; // Prevent drawing in negative space
        
        ctx.font = fontStr;
        const textWidth = ctx.measureText(text).width;
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, maxW, heightSize);
        ctx.clip();
        
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        let drawX = x;
        if (centerIfFits && textWidth < maxW) {
            drawX = x + (maxW - textWidth) / 2;
        }
        
        ctx.fillText(text, drawX, y);
        
        // If it exceeded maxTextWidth, draw a gradient mask over the right edge
        if (textWidth > maxW && fadeW > 0) {
            const actualFadeW = Math.min(fadeW, maxW);
            const fadeStartX = x + maxW - actualFadeW;
            
            if (actualFadeW > 0) {
                let r=0, g=0, b=0;
                if (bgColor.startsWith('#')) {
                    const hex = bgColor.replace('#', '');
                    r = parseInt(hex.substring(0, 2), 16) || 0;
                    g = parseInt(hex.substring(2, 4), 16) || 0;
                    b = parseInt(hex.substring(4, 6), 16) || 0;
                }
                
                const grad = ctx.createLinearGradient(fadeStartX, 0, fadeStartX + actualFadeW, 0);
                grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
                grad.addColorStop(1, `rgba(${r},${g},${b},1)`);
                
                ctx.fillStyle = grad;
                ctx.fillRect(fadeStartX, y, actualFadeW, heightSize);
            }
        }
        ctx.restore();
    };

    if (isMicroMode) {
        // --- Micro Mode (<=60px) ---
        // 1. Centered Artwork
        const artSize = height - (paddingY * 2);
        const artX = (width - artSize) / 2;
        if (currentCoverImage) {
            ctx.drawImage(currentCoverImage, artX, paddingY, artSize, artSize);
        } else {
            drawPlaceholderIcon(ctx, artX, paddingY, artSize, mainColor);
        }
        
        // 2. Full Width Progress Bar
        const progressHeight = 3;
        const progressY = height - paddingY - progressHeight;
        const progressLeft = paddingX;
        const progressWidth = Math.max(0, width - (paddingX * 2));
        const progressFillWidth = currentTimeline.duration > 0 
            ? Math.min((currentTimeline.position / currentTimeline.duration) * progressWidth, progressWidth) 
            : progressWidth;

        ctx.fillStyle = progressBgColor;
        ctx.fillRect(progressLeft, progressY, progressWidth, progressHeight);
        
        ctx.fillStyle = progressFillColor;
        ctx.fillRect(progressLeft, progressY, progressFillWidth, progressHeight);

    } else if (isMiniMode) {
        // --- Mini Mode (61px - 119px) --- Vertical layout
        // Cover Art
        const artSize = 34; // Expanded size
        const artX = (width - artSize) / 2;
        const artY = paddingY; // Strictly respect top padding
        if (currentCoverImage) {
            ctx.drawImage(currentCoverImage, artX, artY, artSize, artSize);
        } else {
            drawPlaceholderIcon(ctx, artX, artY, artSize, mainColor);
        }

        // Progress Bar
        const progressHeight = 3;
        const progressY = height - paddingY - progressHeight; // 60 - 5 - 3 = 52
        const progressLeft = paddingX;
        const progressWidth = Math.max(0, width - (paddingX * 2));
        const progressFillWidth = currentTimeline.duration > 0 
            ? Math.min((currentTimeline.position / currentTimeline.duration) * progressWidth, progressWidth) 
            : progressWidth;

        ctx.fillStyle = progressBgColor;
        ctx.fillRect(progressLeft, progressY, progressWidth, progressHeight);
        ctx.fillStyle = progressFillColor;
        ctx.fillRect(progressLeft, progressY, progressFillWidth, progressHeight);

        // Title Text
        const title = currentMedia.title || 'Unknown';
        const maxTextW = Math.max(0, width - (paddingX * 2));
        // text Y = 41 (leaves 2px gap from art at 39, and 2px gap to progress bar at 52)
        drawFadedText(title, paddingX, 41, maxTextW, `9px ${fontMain}`, mainColor, 12, 16, true);

    } else {
        // --- Compact & Normal Modes (>= 120px) ---
        let textX = paddingX;
        
        // 1. Cover Art
        const artSize = height - (paddingY * 2);
        if (currentCoverImage) {
            ctx.drawImage(currentCoverImage, paddingX, paddingY, artSize, artSize);
        } else {
            drawPlaceholderIcon(ctx, paddingX, paddingY, artSize, mainColor);
        }
        textX = paddingX + artSize + 5; // 5px gap between artwork and text

        // 2. Time Text Dimensions (calculated early for layout)
        let timeText;
        if (!currentTimeline || isNaN(currentTimeline.duration) || currentTimeline.duration <= 0) {
            timeText = "--:--";
        } else {
            const posStr = formatTime(currentTimeline.position);
            const durStr = formatTime(currentTimeline.duration);
            timeText = `${posStr}/${durStr}`;
        }
        
        ctx.font = `11px ${fontTime}`;
        const timeTextWidth = ctx.measureText(timeText).width;
        const timeTextRight = width - paddingX; // Symmetrical right padding
        const timeTextLeft = timeTextRight - timeTextWidth;
        
        // 3. Progress Bar
        const progressHeight = 3;
        const progressY = height - paddingY - progressHeight; // Leaves padding at bottom
        
        const progressLeft = textX;
        const progressRight = timeTextRight;
        const progressWidth = Math.max(0, progressRight - progressLeft);
        
        const progressFillWidth = currentTimeline.duration > 0 
            ? Math.min((currentTimeline.position / currentTimeline.duration) * progressWidth, progressWidth) 
            : progressWidth;

        // Background of progress bar
        ctx.fillStyle = progressBgColor;
        ctx.fillRect(progressLeft, progressY, progressWidth, progressHeight);
        
        // Filled part
        ctx.fillStyle = progressFillColor;
        ctx.fillRect(progressLeft, progressY, progressFillWidth, progressHeight);

        // 4. Text Content
        const title = currentMedia.title || 'Unknown';
        const artist = currentMedia.artist || currentMedia.albumArtist || 'Unknown Artist';
        const albumTitle = currentMedia.albumTitle || '';
        const subText = albumTitle ? `${artist} — ${albumTitle}` : artist;
        
        if (isCompactMode) {
            // Compact Mode (120px - 179px)
            // Layout identical to Normal Mode, but mask extends to the right edge
            const maxTextW = Math.max(0, timeTextRight - textX); 
            drawFadedText(title, textX, 5, maxTextW, `bold 16px ${fontMain}`, mainColor, 18, 24);
            drawFadedText(subText, textX, 23, maxTextW, `12px ${fontMain}`, subColor, 14, 24);
        } else {
            // Normal Mode (>= 180px)
            // 5px horizontal gap between the text mask and the time text
            const maxTextW = Math.max(0, timeTextLeft - 5 - textX); 
            drawFadedText(title, textX, 5, maxTextW, `bold 16px ${fontMain}`, mainColor, 18, 24);
            drawFadedText(subText, textX, 23, maxTextW, `12px ${fontMain}`, subColor, 14, 24);
        }

        // 5. Draw Time Text On Top (above the progress bar)
        const timeTextBottom = progressY;
        ctx.font = `11px ${fontTime}`; // Reset font to fix layout issues
        ctx.fillStyle = subColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(timeText, timeTextRight, timeTextBottom);
    }

    // Output to Flexbar
    const base64Image = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    
    const renderKey = JSON.parse(JSON.stringify(key));
    // Workaround for SDK base64 bug: mutate key style directly and use 'draw' type
    renderKey.style.showImage = true;
    renderKey.style.showIcon = false;
    renderKey.style.showTitle = false;
    renderKey.style.image = `data:image/png;base64,${base64Image}`;
    
    plugin.draw(serialNumber, renderKey, 'draw').catch(err => logger.error("Canvas draw failed:", err));
}

// Handle plugin interactions if there are any clickable keys
plugin.on('plugin.data', (payload) => {
    const keyCid = payload?.data?.key?.cid;
    
    const isClosed = !currentMedia || !currentMedia.title || !currentAppId || currentPlayback.playbackStatus === PlaybackStatus.CLOSED;
    if (isClosed) {
        return { status: 'error' }; // Prevent toast notifications by omitting message
    }
    
    try {
        switch (keyCid) {
            case 'com.michikora.smtcplugin.playpause':
                tryTogglePlayPause(currentAppId);
                // Optimistic update: instantly predict state to override client animation
                if (currentPlayback.playbackStatus === PlaybackStatus.PLAYING) {
                    currentPlayback.playbackStatus = PlaybackStatus.PAUSED;
                } else if (currentPlayback.playbackStatus === PlaybackStatus.PAUSED) {
                    currentPlayback.playbackStatus = PlaybackStatus.PLAYING;
                }
                requestRefreshAllKeys();
                scheduleStateVerification();
                break;
            case 'com.michikora.smtcplugin.previous':
                trySkipPrevious(currentAppId);
                break;
            case 'com.michikora.smtcplugin.next':
                trySkipNext(currentAppId);
                break;
            case 'com.michikora.smtcplugin.shuffle':
                if (currentPlayback && currentPlayback.isShuffleActive !== undefined) {
                    tryChangeShuffleActive(currentAppId, !currentPlayback.isShuffleActive);
                    currentPlayback.isShuffleActive = !currentPlayback.isShuffleActive;
                    requestRefreshAllKeys();
                    scheduleStateVerification();
                }
                break;
            case 'com.michikora.smtcplugin.loop':
                if (currentPlayback && currentPlayback.autoRepeatMode !== undefined) {
                    let nextMode = 0;
                    if (currentPlayback.autoRepeatMode === 0) nextMode = 2; // None -> List
                    else if (currentPlayback.autoRepeatMode === 2) nextMode = 1; // List -> Track
                    else if (currentPlayback.autoRepeatMode === 1) nextMode = 0; // Track -> None
                    tryChangeAutoRepeatMode(currentAppId, nextMode);
                    currentPlayback.autoRepeatMode = nextMode;
                    requestRefreshAllKeys();
                    scheduleStateVerification();
                }
                break;
            case 'com.michikora.smtcplugin.volume':
                const newValue = payload?.data?.value;
                if (typeof newValue === 'number') {
                    currentAppVolume = newValue;
                    const volFloat = newValue / 100.0;
                    if (mixerWorker) {
                        mixerWorker.postMessage({ type: 'setVolume', volume: volFloat });
                    }
                }
                break;
        }
    } catch (e) {
        logger.error(`[Plugin] Control error for ${keyCid}:`, e);
    }
    return { status: 'success' }; // Omit message to prevent frequent toast popups
});
// Auto-correction for optimistic updates
let verificationTimeout = null;
function scheduleStateVerification() {
    if (verificationTimeout) clearTimeout(verificationTimeout);
    verificationTimeout = setTimeout(() => {
        if (currentAppId) {
            try {
                const session = SMTCMonitor.getMediaSessionByAppId(currentAppId);
                if (session && session.playback) {
                    currentPlayback = session.playback;
                    requestRefreshAllKeys();
                }
            } catch (e) {
                logger.error("[Plugin] Failed to verify true state:", e);
            }
        }
    }, 1500); // 1.5 seconds after click, forcefully pull the REAL state from SMTC
}

// ================= WCAG Color Contrast Utilities =================

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 8) hex = hex.substring(0, 6); // RRGGBBAA -> RRGGBB
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1).toUpperCase();
}

function blendColors(fgHex, bgHex, ratio) {
    const fg = hexToRgb(fgHex);
    const bg = hexToRgb(bgHex);
    return rgbToHex(
        fg.r * ratio + bg.r * (1 - ratio),
        fg.g * ratio + bg.g * (1 - ratio),
        fg.b * ratio + bg.b * (1 - ratio)
    );
}

function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrast(rgb1, rgb2) {
    const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function ensureContrast(fgHex, bgHex, minContrast = 4.5) {
    const fgRgb = hexToRgb(fgHex);
    const bgRgb = hexToRgb(bgHex);
    let contrast = getContrast(fgRgb, bgRgb);
    
    if (contrast >= minContrast) return fgHex; // Safe, no adjustment needed
    
    // Determine blend direction: if bg is dark (luminance < 0.5), blend to white, else blend to black
    const bgLuminance = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
    const targetRgb = bgLuminance < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    
    // Blend loop: mix 5% more towards the target color each step until contrast is met
    let currentRgb = { ...fgRgb };
    for (let i = 1; i <= 20; i++) {
        const ratio = i * 0.05; 
        currentRgb = {
            r: fgRgb.r + (targetRgb.r - fgRgb.r) * ratio,
            g: fgRgb.g + (targetRgb.g - fgRgb.g) * ratio,
            b: fgRgb.b + (targetRgb.b - fgRgb.b) * ratio
        };
        if (getContrast(currentRgb, bgRgb) >= minContrast) break;
    }
    return rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);
}
