export type ChartPoint = {
  x: number;
  y: number;
};

export function smoothLinePath(points: ChartPoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }

    const previous = points[index - 1];
    const midpointX = (previous.x + point.x) / 2;
    return `${path} C ${midpointX} ${previous.y}, ${midpointX} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}

export function smoothAreaPath(points: ChartPoint[], baselineY: number) {
  if (points.length < 2) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];

  return `${smoothLinePath(points)} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}
