// 速查: the player asks how to say something in Japanese, or about a word or grammar point, by typing or by voice. Each answer
// shows the Japanese (ruby readings, 🔊 to hear it), the meaning and usage in Chinese, a JLPT badge and examples. Lookups are
// kept in a local history (game/lookup). Not the character chat: nothing here reaches her chat or her voice.
import { useRef, useState } from 'react';
import {
  addLookup, askLookup, clearLookups, jaDisplay, jaSpeakable, levelBadge, LOOKUP_MAX_CHARS, loadLookups, newLookupId, removeLookup, saveLookups,
  stripJaTags, type LookupAnswer, type LookupEntry,
} from '../game/lookup';
import { aiServicesOf, loadTutor } from '../game/tutor';
import { speakReply, stopSpeaking } from '../game/tts';
import { rubyNodes } from './Furigana';
import { speechNoteText, useSpeechInput } from './useSpeechInput';
import { IconClose, IconMic, IconSpeaker } from './icons';
import { useSheetKeyboard } from './useSheetKeyboard';

type Lang = 'zh-TW' | 'ja-JP';

export function LookupSheet(props: { onClose: () => void; ready: boolean; theme?: 'dark' }) {
  const { ready } = props;
  const [entries, setEntries] = useState<LookupEntry[]>(loadLookups);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [live, setLive] = useState(''); // what the mic hears so far
  const [lang, setLang] = useState<Lang>('zh-TW'); // the recognition language: 中 (default) or 日
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboard = useSheetKeyboard(backdropRef, sheetRef, { anchor: formRef }); // the sheet sits on the keyboard, the page never slides

  const mic = useSpeechInput({
    onStart: () => setNote(''),
    onPartial: (t) => setLive(t),
    onFinal: (t) => { setLive(''); setQ(t); }, // the text goes into the field; the player sends it
    onEnd: () => setLive(''),
    onError: (code) => { setNote(speechNoteText(code)); setLive(''); },
  }, { lang });

  const close = () => {
    if (mic.listening) mic.stop();
    stopSpeaking();
    props.onClose();
  };

  const submit = async () => {
    const text = q.trim(); // typed as is: 中文 asks how to say it, 日文 asks what it means (server/prompts.ts LOOKUP_SYSTEM)
    if (!text || busy || !ready) return;
    setBusy(true);
    setErr('');
    const cfg = loadTutor();
    const r = await askLookup(text, undefined, cfg.helperModel, aiServicesOf(cfg));
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    const entry: LookupEntry = { id: newLookupId(), q: text, at: Date.now(), answer: r.answer, raw: r.answer ? undefined : r.raw };
    setEntries((list) => saveLookups(addLookup(list, entry)));
    setQ('');
  };

  /** hear a Japanese line (readings and tags are not spoken) */
  const say = (ja: string) => {
    if (mic.listening) mic.stop();
    speakReply(jaSpeakable(ja));
  };

  const clear = () => setEntries(clearLookups());

  const ja = (text: string) => (
    <span className="lk-ja-line">
      <span className="lk-ja">{rubyNodes(jaDisplay(text))}</span>
      <button type="button" className="lk-speak" aria-label="播放這句日文" title="播放" onClick={() => say(text)}><IconSpeaker /></button>
    </span>
  );

  const badge = (level: LookupAnswer['items'][number]['level']) => <span className="lk-badge" data-level={level}>{levelBadge(level)}</span>;

  const answerBody = (a: LookupAnswer) => (
    <div className="lk-answer">
      {a.message && <p className="lk-msg">{stripJaTags(a.message)}</p>}
      {a.items.length > 0 && (
        <ul className="lk-items">
          {a.items.map((it, i) => (
            <li key={`i${i}`} className="lk-item-row">
              {ja(it.ja)}
              <div className="lk-zh">{badge(it.level)} {stripJaTags(it.zh)}</div>
              {it.note && <small className="lk-note">{stripJaTags(it.note)}</small>}
            </li>
          ))}
        </ul>
      )}
      {a.grammar.length > 0 && (
        <>
          <h4 className="lk-h">文法</h4>
          <ul className="lk-items">
            {a.grammar.map((g, i) => (
              <li key={`g${i}`} className="lk-item-row">
                {g.point ? ja(g.point) : null}
                <div className="lk-zh">{badge(g.level)} {stripJaTags(g.explain)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.examples.length > 0 && (
        <>
          <h4 className="lk-h">例句</h4>
          <ul className="lk-items">
            {a.examples.map((ex, i) => (
              <li key={`e${i}`} className="lk-item-row">
                {ja(ex.ja)}
                <div className="lk-zh">{stripJaTags(ex.zh)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <div ref={backdropRef} className={props.theme === 'dark' ? 'sheet-backdrop sheet-dark' : 'sheet-backdrop'} onClick={close}>
      <section ref={sheetRef} className="sheet as-tips as-lookup" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="速查"
        onFocus={keyboard.onFocus} onBlur={keyboard.onBlur}>
        <div className="sheet-head">
          <strong>速查</strong>
          <button className="sheet-close" onClick={close} aria-label="關閉"><IconClose /></button>
        </div>

        {!ready && (
          <p className="lk-need" role="status">速查使用目前選擇的 AI 服務。請到設定登入 ChatGPT 帳號，或在電腦設定 OpenAI API key，並手動選擇服務。</p>
        )}

        {/* 查 only once the keyboard is down: with it up, the return key just closes it (the answer then shows on a full sheet) */}
        <form ref={formRef} className="lk-form" onSubmit={(ev) => { ev.preventDefault(); if (keyboard.open) inputRef.current?.blur(); else void submit(); }}>
          <input ref={inputRef} value={live && mic.listening ? live : q} placeholder="打中文查日文說法，打日文查意思：沒什麼想法、〜てしまう" aria-label="要查的內容"
            maxLength={LOOKUP_MAX_CHARS} disabled={!ready} onChange={(ev) => setQ(ev.target.value)} />
          <div className="lk-form-row">
            <div className="as-seg lk-lang" role="radiogroup" aria-label="語音辨識語言">
              {([['zh-TW', '中'], ['ja-JP', '日']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={lang === v} className={lang === v ? 'on' : ''} onClick={() => setLang(v)}>{l}</button>
              ))}
            </div>
            <button type="button" className={mic.listening ? 'as-small on' : 'as-small'} aria-pressed={mic.listening}
              aria-label={mic.listening ? '停止聽寫' : '語音輸入'} disabled={!ready || !mic.supported}
              onClick={() => (mic.listening ? mic.stop() : mic.start())}>
              {mic.listening ? '聆聽中…' : <IconMic />}
            </button>
            <button type="submit" className="as-small" disabled={!ready || busy || !q.trim() || keyboard.open}>查</button>
          </div>
        </form>
        {note && <div className="as-mic-note" role="status">{note}</div>}
        {err && <div className="tip-verdict ng" role="status">{err}</div>}
        {busy && <div className="tip-verdict" role="status">查詢中…</div>}

        <div className="as-settings-body">
          <div className="lk-history-head">
            <strong>查詢紀錄</strong>
            {entries.length > 0 && <button type="button" className="as-small danger" onClick={clear}>清除</button>}
          </div>
          {entries.length === 0 && <p className="tip-empty">還沒有查過。輸入或說出想查的日文說法、詞彙或文法就能查。</p>}
          <ul className="lk-list">
            {entries.map((e, i) => (
              <li key={e.id} className="lk-item">
                <button type="button" className="lk-del" aria-label={`刪除「${e.q}」`} title="刪除這筆"
                  onClick={() => setEntries((list) => saveLookups(removeLookup(list, e.id)))}><IconClose size={18} /></button>
                <details className="lk-entry" open={i === 0}>
                  <summary>
                    <span className="lk-q">{e.q}</span>
                  </summary>
                  {e.answer ? answerBody(e.answer) : <div className="lk-raw">{rubyNodes(jaDisplay(e.raw ?? '（沒有回覆）'))}</div>}
                </details>
              </li>
            ))}
          </ul>
          <small className="lk-foot">級數依常見 JLPT 參考清單</small>
        </div>
      </section>
    </div>
  );
}
