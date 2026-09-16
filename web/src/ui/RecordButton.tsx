import { useSessionStore } from '../store/session';

export function RecordButton() {
  const recording = useSessionStore((s) => s.recording);
  const paused = useSessionStore((s) => s.paused);
  const whisperStatus = useSessionStore((s) => s.whisperStatus);
  const micLevel = useSessionStore((s) => s.micLevel);
  const toggleRecording = useSessionStore((s) => s.toggleRecording);
  const togglePause = useSessionStore((s) => s.togglePause);

  const disabled = whisperStatus === 'down';

  return (
    <div className="record-dock">
      <div className="record-dock__row">
        {recording && (
          <button
            className={`pause-button ${paused ? 'pause-button--paused' : ''}`}
            onClick={togglePause}
            aria-label={paused ? 'Продолжить запись' : 'Приостановить запись'}
            title={paused ? 'Продолжить запись' : 'Приостановить запись'}
          >
            {paused ? <span className="pause-button__play" /> : <span className="pause-button__bars" />}
          </button>
        )}
        <button
          className={`record-button ${recording ? 'record-button--recording' : ''} ${paused ? 'record-button--paused' : ''}`}
          onClick={() => void toggleRecording()}
          disabled={disabled}
          aria-label={recording ? 'Остановить запись' : 'Начать запись'}
          title={disabled ? 'Whisper недоступен' : undefined}
        >
          <span className="record-button__level" style={{ '--level': Math.min(1, micLevel * 6) } as React.CSSProperties} />
          <span className="record-button__ring" />
          <span className="record-button__icon" />
        </button>
      </div>
      {disabled && <span className="record-hint">Whisper недоступен</span>}
      {paused && !disabled && <span className="record-hint">Пауза — жми ▶, чтобы продолжить</span>}
    </div>
  );
}
