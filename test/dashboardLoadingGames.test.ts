import assert from "node:assert/strict";
import test from "node:test";
import { advanceLoadingGame, controlLoadingGame, createLoadingGame, gameForLoad, playTimeExpired, type LoadingGame } from "../src/dashboardLoadingGames.js";

function advance(game: LoadingGame, ms: number): LoadingGame {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) game = advanceLoadingGame(game, 20, () => 0);
  return game;
}

test("loading games rotate across all three games and recover from an invalid saved index", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(gameForLoad), ["flappy", "snake", "tetris", "flappy", "snake", "tetris"]);
  for (const invalid of [-1, NaN, Infinity, 1.5]) assert.equal(gameForLoad(invalid), "flappy");
});

test("the play limit starts on first play and expires at exactly twenty seconds", () => {
  assert.equal(playTimeExpired(null, 90_000), false);
  assert.equal(playTimeExpired(50_000, 69_999), false);
  assert.equal(playTimeExpired(50_000, 70_000), true);
  assert.equal(playTimeExpired(50_000, 80_000), true);
});

test("Flappy Bird responds to a flap and ends on a pipe or ground collision", () => {
  const game = createLoadingGame("flappy");
  if (game.kind !== "flappy") throw new Error("Wrong game");
  const flying = advanceLoadingGame(controlLoadingGame(game, "action"), 40);
  assert.equal(flying.kind === "flappy" && flying.y < game.y, true);
  assert.equal(advanceLoadingGame({ ...game, y: 253, velocity: 100 }, 40).over, true);
  assert.equal(advanceLoadingGame({ ...game, y: 20, pipes: [{ x: 55, gapY: 130, passed: false }] }, 20).over, true);
  const passed = advanceLoadingGame({ ...game, pipes: [{ x: 15, gapY: 130, passed: false }] }, 20);
  assert.equal(passed.score, 1);
  assert.equal(advanceLoadingGame(passed, 20).score, 1);
});

test("Snake eats food, grows, and places new food away from its body", () => {
  const game = createLoadingGame("snake", () => 0);
  if (game.kind !== "snake") throw new Error("Wrong game");
  const next = advance({ ...game, food: { x: 6, y: 7 } }, 160);
  if (next.kind !== "snake") throw new Error("Wrong game");
  assert.equal(next.score, 1);
  assert.equal(next.snake.length, 4);
  assert.equal(next.snake.some((p) => p.x === next.food.x && p.y === next.food.y), false);
});

test("Snake rejects reversing direction even after two inputs before the next tick", () => {
  const game = createLoadingGame("snake");
  const queued = controlLoadingGame(controlLoadingGame(game, "up"), "left");
  const next = advance(queued, 160);
  if (next.kind !== "snake") throw new Error("Wrong game");
  assert.deepEqual(next.snake[0], { x: 5, y: 6 });
  assert.equal(advance(createLoadingGame("snake"), 160 * 7).over, true);
});

test("Tetris clears a complete row and stops when the next piece cannot spawn", () => {
  const game = createLoadingGame("tetris", () => 0);
  if (game.kind !== "tetris") throw new Error("Wrong game");
  const board = game.board.map((row) => [...row]);
  board[15] = [0, 0, 0, 0, 2, 2, 2, 2, 2, 2];
  const cleared = controlLoadingGame({ ...game, board, piece: { x: 0, y: 15, cells: [[1, 1, 1, 1]], color: 1 } }, "down", () => 0);
  if (cleared.kind !== "tetris") throw new Error("Wrong game");
  assert.equal(cleared.score, 101);
  assert.equal(cleared.board.length, 16);
  assert.deepEqual(cleared.board[15], Array(10).fill(0));
  const blocked = game.board.map((row) => [...row]);
  blocked[1]![3] = 2;
  assert.equal(controlLoadingGame({ ...game, board: blocked, piece: { x: 0, y: 15, cells: [[1]], color: 1 } }, "down", () => 0).over, true);
});

test("Tetris rotates with wall adjustment and cannot move through a wall", () => {
  const game = createLoadingGame("tetris", () => 0);
  if (game.kind !== "tetris") throw new Error("Wrong game");
  const vertical = { ...game, piece: { x: 9, y: 4, cells: [[1, 0, 0], [1, 0, 0], [1, 0, 0]], color: 1 } };
  const rotated = controlLoadingGame(vertical, "up");
  if (rotated.kind !== "tetris") throw new Error("Wrong game");
  assert.equal(rotated.piece.x, 7);
  assert.deepEqual(rotated.piece.cells[0], [1, 1, 1]);
  assert.deepEqual(controlLoadingGame(rotated, "right"), rotated);
  const falling = advance(game, 450);
  assert.equal(falling.kind === "tetris" && falling.piece.y, 1);
});
