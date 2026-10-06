"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { advanceLoadingGame, controlLoadingGame, createLoadingGame, gameForLoad, LOADING_GAME_PLAY_MS, playTimeExpired,
  type GameInput, type LoadingGame } from "../../src/dashboardLoadingGames.js";

const titles = { flappy: "Flappy Bird", snake: "Snake", tetris: "Tetris" };
const instructions = {
  flappy: "Klik, tik of druk op spatie om te vliegen. Ontwijk de buizen.",
  snake: "Gebruik de pijltjestoetsen of knoppen. Eet de stippen en ontwijk jezelf en de rand.",
  tetris: "Pijltjes links/rechts om te bewegen, omhoog om te draaien en omlaag om te zakken. Vul een rij."
};
const BACKGROUND_DELAY_MS = 12_000;
let nextGameIndex = 0;

export function AccountManagerLoadingGame() {
  const [game, setGame] = useState<LoadingGame>(() => createLoadingGame("flappy"));
  const engine = useRef(game);
  const selected = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [limited, setLimited] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const instructionsId = useId();

  function publish(next: LoadingGame) { engine.current = next; setGame(next); }
  useEffect(() => {
    if (selected.current) return;
    selected.current = true;
    let index = nextGameIndex;
    try {
      const stored = Number(sessionStorage.getItem("ledoux-loading-game") ?? index);
      if (Number.isSafeInteger(stored) && stored >= 0) index = stored;
      sessionStorage.setItem("ledoux-loading-game", String((index + 1) % 3));
    } catch { /* Rotation also works when browser storage is unavailable. */ }
    nextGameIndex = (index + 1) % 3;
    publish(createLoadingGame(gameForLoad(index)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (playing) surface.current?.focus({ preventScroll: true });
  }, [playing]);

  useEffect(() => {
    if (startedAt === null) return;
    const elapsed = performance.now() - startedAt;
    const backgroundTimeout = window.setTimeout(() => setShowBackground(true), Math.max(0, BACKGROUND_DELAY_MS - elapsed));
    const timeout = window.setTimeout(() => setLimited(true), Math.max(0, LOADING_GAME_PLAY_MS - elapsed));
    return () => { window.clearTimeout(backgroundTimeout); window.clearTimeout(timeout); };
  }, [startedAt]);

  useEffect(() => {
    if (!playing || limited) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if (playTimeExpired(startedAt, now)) { setLimited(true); return; }
      const next = advanceLoadingGame(engine.current, now - previous);
      previous = now;
      publish(next);
      if (next.over) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, limited, startedAt]);

  function start(input?: GameInput) {
    if (!ready) return;
    if (limited || playTimeExpired(startedAt, performance.now())) { setLimited(true); return; }
    let next = engine.current.over ? createLoadingGame(engine.current.kind) : engine.current;
    if (next.kind === "flappy") next = controlLoadingGame(next, "action");
    else if (input) next = controlLoadingGame(next, input);
    publish(next);
    if (startedAt === null) setStartedAt(performance.now());
    setPlaying(true);
  }
  function control(input: GameInput) {
    if (!playing || limited) return;
    if (playTimeExpired(startedAt, performance.now())) { setLimited(true); return; }
    publish(controlLoadingGame(engine.current, input));
    if (engine.current.over) setPlaying(false);
  }
  function keyDown(event: KeyboardEvent) {
    // Let buttons keep their normal Space/Enter activation.
    if ((event.key === " " || event.key === "Enter") && event.target !== surface.current) return;
    const input: GameInput | undefined = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "action", Enter: "action" } as Record<string, GameInput>)[event.key];
    if (!input || limited || !ready) return;
    if (!playing && event.target !== surface.current) return;
    event.preventDefault();
    if (!playing) start(input);
    else control(input);
  }

  return <div className="loading-game" onKeyDown={keyDown}>
    <div className="loading-game-heading"><h2>{titles[game.kind]}</h2><span>Score {game.score}</span></div>
    {limited ? <div className="loading-game-timeout" role="status">
      <strong>stop met spelen en werk door</strong>
      <p>De gegevens worden verder geladen.</p>
    </div> : <>
      <div ref={surface} className={`loading-game-surface${showBackground ? " loading-game-surface--photo" : ""}`} tabIndex={ready ? 0 : -1} role={playing ? "group" : "button"} aria-disabled={!ready}
        aria-label={`${titles[game.kind]} speelveld`} aria-describedby={instructionsId}
        onClick={() => { if (!ready) return; if (!playing) start(); else if (game.kind === "flappy") control("action"); }}>
        <img className="loading-game-background" src="/loading-games/after-12-seconds.png" alt="" aria-hidden="true" draggable={false} decoding="async" />
        <GameBoard game={game} />
        {!playing ? <div className="loading-game-board-caption" aria-hidden="true">{!ready ? "Spel wordt klaargezet…" : game.over ? "Game over" : "Klik of tik om te starten"}</div> : null}
      </div>
      <p className="loading-game-instructions" id={instructionsId}>{instructions[game.kind]}</p>
      {!playing ? <button className="loading-game-start" type="button" disabled={!ready} onClick={() => start()}>{!ready ? "Spel wordt klaargezet…" : game.over ? "Opnieuw proberen" : "Speel tijdens het laden"}</button>
        : <div className="loading-game-controls" aria-label="Spelbediening">
          {game.kind === "flappy" ? <button type="button" onClick={() => control("action")}>Vlieg ↑</button>
            : <>
              <button type="button" aria-label="Naar links" onClick={() => control("left")}>←</button>
              <button type="button" aria-label={game.kind === "tetris" ? "Blok draaien" : "Omhoog"} onClick={() => control("up")}>{game.kind === "tetris" ? "↻" : "↑"}</button>
              <button type="button" aria-label="Naar rechts" onClick={() => control("right")}>→</button>
              <button type="button" aria-label={game.kind === "tetris" ? "Blok laten zakken" : "Omlaag"} onClick={() => control("down")}>↓</button>
            </>}
        </div>}
      <span className="loading-game-limit">Maximaal 20 seconden vanaf je eerste start.</span>
    </>}
  </div>;
}

function GameBoard({ game }: { game: LoadingGame }) {
  if (game.kind === "flappy") return <svg viewBox="0 0 240 280" role="img" aria-label="Vogel met hindernissen">
    <defs><pattern id="loading-flappy-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity=".08" /></pattern></defs>
    <rect width="240" height="280" fill="url(#loading-flappy-grid)" />
    {game.pipes.map((pipe, index) => <g key={index} className="loading-game-pipe">
      <rect x={pipe.x} y={0} width={34} height={pipe.gapY - 45} rx={3} />
      <rect x={pipe.x} y={pipe.gapY + 45} width={34} height={260 - pipe.gapY - 45} rx={3} />
    </g>)}
    <path d="M0 260H240" stroke="currentColor" strokeOpacity=".25" />
    <g transform={`translate(58 ${game.y}) rotate(${Math.max(-25, Math.min(60, game.velocity / 5))})`}>
      <ellipse rx={10} ry={8} fill="#ffd166" /><path d="M7 -1L15 2L7 4" fill="#ff965c" />
      <circle cx={4} cy={-3} r={2} fill="#171717" /><path d="M-7 1L-1 4" stroke="#b07c20" strokeWidth={2} />
    </g>
  </svg>;
  if (game.kind === "snake") return <svg viewBox="0 0 240 280" role="img" aria-label="Slang en voedsel">
    <defs><pattern id="loading-snake-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity=".1" /></pattern></defs>
    <rect width="240" height="280" fill="url(#loading-snake-grid)" />
    <circle cx={game.food.x * 20 + 10} cy={game.food.y * 20 + 10} r={6} fill="#ff965c" />
    {game.snake.map((point, index) => <rect key={index} className="loading-game-snake" x={point.x * 20 + 1} y={point.y * 20 + 1} width={18} height={18} rx={index === 0 ? 6 : 3} opacity={index === 0 ? 1 : .7} />)}
  </svg>;
  const colors = ["transparent", "#70d6ff", "#ffd166", "#bf9bff", "#80ed99", "#ff7096", "#82aaff", "#ff965c"];
  return <svg viewBox="0 0 200 320" role="img" aria-label="Vallende blokken">
    <defs><pattern id="loading-tetris-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0L0 0L0 20" fill="none" stroke="currentColor" strokeOpacity=".1" /></pattern></defs>
    <rect width="200" height="320" fill="url(#loading-tetris-grid)" />
    {game.board.flatMap((row, y) => row.map((cell, x) => cell ? <rect key={`${x}-${y}`} x={x * 20 + 1} y={y * 20 + 1} width={18} height={18} rx={2} fill={colors[cell]} /> : null))}
    {game.piece.cells.flatMap((row, y) => row.map((cell, x) => cell ? <rect key={`piece-${x}-${y}`} x={(game.piece.x + x) * 20 + 1} y={(game.piece.y + y) * 20 + 1} width={18} height={18} rx={2} fill={colors[game.piece.color]} /> : null))}
  </svg>;
}
