export const LOADING_GAME_PLAY_MS = 20_000;
export const LOADING_GAMES = ["flappy", "snake", "tetris"] as const;
export type LoadingGameKind = typeof LOADING_GAMES[number];
export type GameInput = "left" | "right" | "up" | "down" | "action";
export type Point = { x: number; y: number };
type BaseGame = { score: number; over: boolean; elapsed: number };
export type FlappyGame = BaseGame & { kind: "flappy"; y: number; velocity: number; pipes: { x: number; gapY: number; passed: boolean }[] };
export type SnakeGame = BaseGame & { kind: "snake"; snake: Point[]; direction: Point; nextDirection: Point; food: Point };
export type TetrisGame = BaseGame & { kind: "tetris"; board: number[][]; piece: { x: number; y: number; cells: number[][]; color: number } };
export type LoadingGame = FlappyGame | SnakeGame | TetrisGame;
const SHAPES = [
  [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
];

export function gameForLoad(index: number): LoadingGameKind {
  return LOADING_GAMES[Number.isSafeInteger(index) && index >= 0 ? index % LOADING_GAMES.length : 0]!;
}
export function playTimeExpired(startedAt: number | null, now: number) {
  return startedAt !== null && now - startedAt >= LOADING_GAME_PLAY_MS;
}
function foodFor(snake: Point[], random: () => number): Point {
  const free: Point[] = [];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 12; x++) {
    if (!snake.some((point) => point.x === x && point.y === y)) free.push({ x, y });
  }
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))] ?? { x: -1, y: -1 };
}
function newPiece(random: () => number): TetrisGame["piece"] {
  const index = Math.min(SHAPES.length - 1, Math.floor(random() * SHAPES.length));
  const cells = SHAPES[index]!.map((row) => [...row]);
  return { x: Math.floor((10 - cells.length) / 2), y: 0, cells, color: index + 1 };
}
export function createLoadingGame(kind: LoadingGameKind, random: () => number = Math.random): LoadingGame {
  const base = { score: 0, over: false, elapsed: 0 };
  if (kind === "flappy") return { ...base, kind, y: 130, velocity: 0, pipes: [{ x: 245, gapY: 130, passed: false }] };
  if (kind === "snake") {
    const snake = [{ x: 5, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 7 }];
    return { ...base, kind, snake, direction: { x: 1, y: 0 }, nextDirection: { x: 1, y: 0 }, food: foodFor(snake, random) };
  }
  return { ...base, kind, board: Array.from({ length: 16 }, () => Array<number>(10).fill(0)), piece: newPiece(random) };
}
function collides(board: number[][], piece: TetrisGame["piece"]) {
  return piece.cells.some((row, y) => row.some((cell, x) => cell && (
    piece.x + x < 0 || piece.x + x >= 10 || piece.y + y < 0 || piece.y + y >= 16 || board[piece.y + y]![piece.x + x]
  )));
}
function dropTetris(game: TetrisGame, random: () => number): TetrisGame {
  const down = { ...game.piece, y: game.piece.y + 1 };
  if (!collides(game.board, down)) return { ...game, piece: down };
  const board = game.board.map((row) => [...row]);
  game.piece.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell) board[game.piece.y + y]![game.piece.x + x] = game.piece.color;
  }));
  const remaining = board.filter((row) => row.some((cell) => cell === 0));
  const cleared = 16 - remaining.length;
  while (remaining.length < 16) remaining.unshift(Array<number>(10).fill(0));
  const piece = newPiece(random);
  return { ...game, board: remaining, piece, score: game.score + 1 + cleared * 100, over: collides(remaining, piece) };
}
export function controlLoadingGame(game: LoadingGame, input: GameInput, random: () => number = Math.random): LoadingGame {
  if (game.over) return game;
  if (game.kind === "flappy") return input === "action" || input === "up" ? { ...game, velocity: -235 } : game;
  if (game.kind === "snake") {
    const direction = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, action: game.nextDirection }[input];
    if (direction.x === -game.direction.x && direction.y === -game.direction.y) return game;
    return { ...game, nextDirection: direction };
  }
  if (input === "down") return dropTetris(game, random);
  if (input === "up" || input === "action") {
    const cells = game.piece.cells[0]!.map((_, x) => game.piece.cells.map((row) => row[x]!).reverse());
    for (const shift of [0, -1, 1, -2, 2]) {
      const piece = { ...game.piece, x: game.piece.x + shift, cells };
      if (!collides(game.board, piece)) return { ...game, piece };
    }
    return game;
  }
  const piece = { ...game.piece, x: game.piece.x + (input === "left" ? -1 : 1) };
  return collides(game.board, piece) ? game : { ...game, piece };
}
export function advanceLoadingGame(game: LoadingGame, deltaMs: number, random: () => number = Math.random): LoadingGame {
  if (game.over) return game;
  const delta = Math.max(0, Math.min(deltaMs, 50));
  if (game.kind === "flappy") {
    const dt = delta / 1000;
    const velocity = game.velocity + 700 * dt;
    const y = game.y + velocity * dt;
    let score = game.score;
    const pipes = game.pipes.map((pipe) => {
      const x = pipe.x - 90 * dt;
      const passed = pipe.passed || x + 34 < 50;
      if (passed && !pipe.passed) score++;
      return { ...pipe, x, passed };
    }).filter((pipe) => pipe.x > -34);
    if (!pipes.length || pipes[pipes.length - 1]!.x < 110) pipes.push({ x: 270, gapY: 80 + random() * 100, passed: false });
    const over = y - 8 < 0 || y + 8 > 260 || pipes.some((pipe) => pipe.x < 66 && pipe.x + 34 > 50 && (y - 8 < pipe.gapY - 45 || y + 8 > pipe.gapY + 45));
    return { ...game, velocity, y, pipes, score, over };
  }
  const interval = game.kind === "snake" ? 160 : 450;
  const elapsed = game.elapsed + delta;
  if (elapsed < interval) return { ...game, elapsed };
  if (game.kind === "tetris") return dropTetris({ ...game, elapsed: elapsed - interval }, random);
  const direction = game.nextDirection;
  const head = { x: game.snake[0]!.x + direction.x, y: game.snake[0]!.y + direction.y };
  const eats = head.x === game.food.x && head.y === game.food.y;
  const body = eats ? game.snake : game.snake.slice(0, -1);
  const over = head.x < 0 || head.x >= 12 || head.y < 0 || head.y >= 14 || body.some((point) => point.x === head.x && point.y === head.y);
  if (over) return { ...game, over: true };
  const snake = [head, ...body];
  const food = eats ? foodFor(snake, random) : game.food;
  return { ...game, snake, food, direction, elapsed: elapsed - interval, score: game.score + (eats ? 1 : 0), over: food.x < 0 };
}
