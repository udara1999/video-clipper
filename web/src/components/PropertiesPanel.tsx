import { useState } from 'react';
import { CANVAS_H, CANVAS_W, FONTS, type ComposeLayout, type TextOverlay } from '../../../shared/compose';
import { pickFile } from '../lib/api';
import type { Selection } from './CompositionPanel';

interface PropertiesPanelProps {
  layout: ComposeLayout;
  onLayoutChange: (l: ComposeLayout) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  clipCount: number;
}

function newText(): TextOverlay {
  return {
    id: crypto.randomUUID(),
    content: 'Part {n}',
    perClip: {},
    x: 120,
    y: 220,
    font: 'Anton',
    sizePx: 96,
    color: '#ffffff',
    background: null,
    shadow: true,
    start: 0,
    end: 3600, // clamped to the clip length at export
  };
}

export function PropertiesPanel({
  layout,
  onLayoutChange,
  selection,
  onSelect,
  clipCount,
}: PropertiesPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const selectedText =
    typeof selection === 'object' && selection
      ? layout.texts.find((t) => t.id === selection.textId) ?? null
      : null;

  function patchText(id: string, p: Partial<TextOverlay>) {
    onLayoutChange({
      ...layout,
      texts: layout.texts.map((t) => (t.id === id ? { ...t, ...p } : t)),
    });
  }

  async function chooseBackground() {
    let path: string | null;
    try {
      path = await pickFile('image');
    } catch (err) {
      setError((err as Error).message ?? 'Failed to choose an image');
      return;
    }
    if (!path) return;
    setError(null);
    onLayoutChange({
      ...layout,
      background: {
        path,
        placement: { x: 0, y: 0, width: CANVAS_W },
      },
    });
    onSelect('background');
  }

  function addText() {
    const t = newText();
    onLayoutChange({ ...layout, texts: [...layout.texts, t] });
    onSelect({ textId: t.id });
  }

  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <div>
      <h2>Canvas</h2>
      <div className="prop-row">
        <label>Video</label>
        <input
          type="number"
          title="X"
          value={Math.round(layout.video.x)}
          onChange={(e) => onLayoutChange({ ...layout, video: { ...layout.video, x: num(e.target.value) } })}
        />
        <input
          type="number"
          title="Y"
          value={Math.round(layout.video.y)}
          onChange={(e) => onLayoutChange({ ...layout, video: { ...layout.video, y: num(e.target.value) } })}
        />
        <input
          type="number"
          title="Width"
          value={Math.round(layout.video.width)}
          onChange={(e) =>
            onLayoutChange({
              ...layout,
              video: { ...layout.video, width: Math.max(80, num(e.target.value)) },
            })
          }
        />
      </div>

      <div className="prop-row">
        <label>Background</label>
        <button onClick={chooseBackground}>
          {layout.background ? 'Change image…' : 'Choose image…'}
        </button>
        {layout.background && (
          <button onClick={() => onLayoutChange({ ...layout, background: null })}>Remove</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {layout.background && (
        <div className="prop-row">
          <label>Image</label>
          <input
            type="number"
            title="X"
            value={Math.round(layout.background.placement.x)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: { ...layout.background!.placement, x: num(e.target.value) },
                },
              })
            }
          />
          <input
            type="number"
            title="Y"
            value={Math.round(layout.background.placement.y)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: { ...layout.background!.placement, y: num(e.target.value) },
                },
              })
            }
          />
          <input
            type="number"
            title="Width"
            value={Math.round(layout.background.placement.width)}
            onChange={(e) =>
              onLayoutChange({
                ...layout,
                background: {
                  ...layout.background!,
                  placement: {
                    ...layout.background!.placement,
                    width: Math.max(40, num(e.target.value)),
                  },
                },
              })
            }
          />
        </div>
      )}

      <h2 style={{ marginTop: '1rem' }}>Texts</h2>
      <ul className="text-list">
        {layout.texts.map((t) => {
          const isSel = typeof selection === 'object' && selection?.textId === t.id;
          return (
            <li key={t.id} className={isSel ? 'selected' : ''}>
              <button className="select" onClick={() => onSelect({ textId: t.id })}>
                {t.content || '(empty)'}
              </button>
              <button
                title="Delete text"
                onClick={() =>
                  onLayoutChange({ ...layout, texts: layout.texts.filter((x) => x.id !== t.id) })
                }
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <button onClick={addText}>Add text</button>

      {selectedText && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="prop-row">
            <label>Text</label>
            <textarea
              value={selectedText.content}
              onChange={(e) => patchText(selectedText.id, { content: e.target.value })}
            />
          </div>
          {clipCount > 1 && (
            <div className="prop-row">
              <label>Per clip</label>
              <table className="per-clip-table">
                <tbody>
                  {Array.from({ length: clipCount }, (_, i) => i + 1).map((n) => (
                    <tr key={n}>
                      <td>Clip {n}</td>
                      <td>
                        <input
                          placeholder={selectedText.content.replace(/\{n\}/g, String(n))}
                          value={selectedText.perClip[n] ?? ''}
                          onChange={(e) => {
                            const perClip = { ...selectedText.perClip };
                            if (e.target.value === '') delete perClip[n];
                            else perClip[n] = e.target.value;
                            patchText(selectedText.id, { perClip });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="prop-row">
            <label>Font</label>
            <select
              value={selectedText.font}
              onChange={(e) => patchText(selectedText.id, { font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              type="number"
              title="Size (canvas px)"
              value={selectedText.sizePx}
              onChange={(e) =>
                patchText(selectedText.id, { sizePx: Math.max(12, num(e.target.value)) })
              }
            />
          </div>
          <div className="prop-row">
            <label>Color</label>
            <input
              type="color"
              value={selectedText.color}
              onChange={(e) => patchText(selectedText.id, { color: e.target.value })}
            />
            <label>Shadow</label>
            <input
              type="checkbox"
              checked={selectedText.shadow}
              onChange={(e) => patchText(selectedText.id, { shadow: e.target.checked })}
            />
          </div>
          <div className="prop-row">
            <label>Box</label>
            <input
              type="checkbox"
              checked={selectedText.background !== null}
              onChange={(e) =>
                patchText(selectedText.id, {
                  background: e.target.checked ? { color: '#000000', opacity: 0.6 } : null,
                })
              }
            />
            {selectedText.background && (
              <>
                <input
                  type="color"
                  value={selectedText.background.color}
                  onChange={(e) =>
                    patchText(selectedText.id, {
                      background: { ...selectedText.background!, color: e.target.value },
                    })
                  }
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  title="Box opacity"
                  value={selectedText.background.opacity}
                  onChange={(e) =>
                    patchText(selectedText.id, {
                      background: {
                        ...selectedText.background!,
                        opacity: Number(e.target.value),
                      },
                    })
                  }
                />
              </>
            )}
          </div>
          <div className="prop-row">
            <label>Show (s)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              title="Start (seconds into each clip)"
              value={selectedText.start}
              onChange={(e) => patchText(selectedText.id, { start: Math.max(0, num(e.target.value)) })}
            />
            <span>→</span>
            <input
              type="number"
              min={0}
              step={0.1}
              title="End (seconds; clamped to the clip length)"
              value={selectedText.end}
              onChange={(e) => patchText(selectedText.id, { end: Math.max(0, num(e.target.value)) })}
            />
          </div>
          <p className="video-info">
            Times are within each clip. Canvas is {CANVAS_W}×{CANVAS_H}. Use {'{n}'} for the
            clip number.
          </p>
        </div>
      )}
    </div>
  );
}
