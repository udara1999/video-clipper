import { useLayoutEffect, useRef, useState } from 'react';
import {
  CANVAS_H,
  CANVAS_W,
  placementHeight,
  resolveTextContent,
  type ComposeLayout,
  type Placement,
  type TextOverlay,
} from '../../../shared/compose';
import { TEXT_LINE_HEIGHT, TEXT_PAD_RATIO, TEXT_SHADOW_CSS } from '../lib/bake';
import { hexToRgba } from '../lib/color';
import { streamUrl, type VideoInfo } from '../lib/api';
import { formatTimestamp } from '../../../shared/time';

export type Selection = 'video' | 'background' | { textId: string } | null;

interface CompositionPanelProps {
  video: VideoInfo;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  layout: ComposeLayout;
  onLayoutChange: (l: ComposeLayout) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onTimeUpdate: (t: number) => void;
}

// Generic pointer-drag: captures the pointer, reports deltas in canvas px.
function startDrag(
  e: React.PointerEvent,
  scale: number,
  onMove: (dxCanvas: number, dyCanvas: number) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const move = (ev: PointerEvent) =>
    onMove((ev.clientX - startX) / scale, (ev.clientY - startY) / scale);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function CompositionPanel({
  video,
  videoRef,
  layout,
  onLayoutChange,
  selection,
  onSelect,
  onTimeUpdate,
}: CompositionPanelProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / CANVAS_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = (v: number) => v * scale;

  function patchVideo(p: Partial<Placement>) {
    onLayoutChange({ ...layout, video: { ...layout.video, ...p } });
  }

  function patchBackground(p: Partial<Placement>) {
    if (!layout.background) return;
    onLayoutChange({
      ...layout,
      background: { ...layout.background, placement: { ...layout.background.placement, ...p } },
    });
  }

  function patchText(id: string, p: Partial<TextOverlay>) {
    onLayoutChange({
      ...layout,
      texts: layout.texts.map((t) => (t.id === id ? { ...t, ...p } : t)),
    });
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  const videoH = placementHeight(layout.video.width, video.width, video.height);

  return (
    <div>
      <div className="stage-wrap">
        <div ref={stageRef} className="stage" onPointerDown={() => onSelect(null)}>
          {layout.background && (
            <div
              className={`layer ${selection === 'background' ? 'selected' : ''}`}
              style={{
                left: px(layout.background.placement.x),
                top: px(layout.background.placement.y),
                width: px(layout.background.placement.width),
              }}
              onPointerDown={(e) => {
                onSelect('background');
                const base = { ...layout.background!.placement };
                startDrag(e, scale, (dx, dy) => patchBackground({ x: base.x + dx, y: base.y + dy }));
              }}
            >
              <img src={streamUrl(layout.background.path)} alt="" draggable={false} />
              {selection === 'background' && (
                <div
                  className="resize-handle"
                  onPointerDown={(e) => {
                    const base = layout.background!.placement.width;
                    startDrag(e, scale, (dx) =>
                      patchBackground({ width: Math.max(40, base + dx) }),
                    );
                  }}
                />
              )}
            </div>
          )}

          <div
            className={`layer ${selection === 'video' ? 'selected' : ''}`}
            style={{
              left: px(layout.video.x),
              top: px(layout.video.y),
              width: px(layout.video.width),
            }}
            onPointerDown={(e) => {
              onSelect('video');
              const base = { ...layout.video };
              startDrag(e, scale, (dx, dy) => patchVideo({ x: base.x + dx, y: base.y + dy }));
            }}
          >
            <video
              ref={videoRef}
              src={streamUrl(video.path)}
              onTimeUpdate={(e) => {
                setTime(e.currentTarget.currentTime);
                onTimeUpdate(e.currentTarget.currentTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {selection === 'video' && (
              <div
                className="resize-handle"
                onPointerDown={(e) => {
                  const base = layout.video.width;
                  startDrag(e, scale, (dx) => patchVideo({ width: Math.max(80, base + dx) }));
                }}
              />
            )}
          </div>

          {layout.texts.map((t) => {
            const selected = typeof selection === 'object' && selection?.textId === t.id;
            const pad = t.sizePx * TEXT_PAD_RATIO * scale;
            return (
              <div
                key={t.id}
                className={`layer text-layer ${selected ? 'selected' : ''}`}
                style={{
                  left: px(t.x) - pad,
                  top: px(t.y) - pad,
                  padding: pad,
                  borderRadius: pad / 2,
                  fontFamily: `"${t.font}"`,
                  fontSize: t.sizePx * scale,
                  lineHeight: TEXT_LINE_HEIGHT,
                  color: t.color,
                  background: t.background
                    ? hexToRgba(t.background.color, t.background.opacity)
                    : 'transparent',
                  textShadow: t.shadow ? TEXT_SHADOW_CSS : 'none',
                }}
                onPointerDown={(e) => {
                  onSelect({ textId: t.id });
                  const base = { x: t.x, y: t.y };
                  startDrag(e, scale, (dx, dy) =>
                    patchText(t.id, { x: base.x + dx, y: base.y + dy }),
                  );
                }}
              >
                {resolveTextContent(t, 1)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="transport">
        <button onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range"
          min={0}
          max={video.durationSec}
          step={0.05}
          value={time}
          onChange={(e) => {
            const el = videoRef.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
        />
        <span className="time">
          {formatTimestamp(time)} / {formatTimestamp(video.durationSec)}
        </span>
      </div>
      <p className="video-info" style={{ marginTop: '0.4rem' }}>
        Video height on canvas: {Math.round(videoH)}px of {CANVAS_H}px
      </p>
    </div>
  );
}
