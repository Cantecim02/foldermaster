import { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { court } from '../game/fileBasketPhysics';
import type { AppTheme } from '../theme';
export function FileBasketHoop({ theme, entered, success, impact }: { theme: AppTheme; entered: boolean; success: boolean; impact: number }) {
  const { rim, board, floor, netDepth, netTaper } = court;
  const mid = (rim.left + rim.right) / 2;
  const metal = theme.isDark ? '#8594A8' : '#64748B';
  const net = success ? theme.colors.success : theme.isDark ? '#E2E8F0' : '#687587';
  const bottom = rim.y + netDepth;
  // Endpoints, board collision face and scoring planes come from the solver.
  return <G>
    <Path d={`M ${board.x + 4} ${board.top + 22} L 344 ${board.top + 35} V ${floor} M 329 ${floor} H 355`} stroke={metal} strokeWidth={7} fill="none" />
    <Rect x={board.x - board.halfWidth} y={board.top} width={board.halfWidth * 2} height={board.bottom - board.top} fill={theme.isDark ? '#C8DDEF' : '#8196AE'} fillOpacity={0.5} stroke={metal} strokeWidth={1} />
    <Path d={`M ${board.x - 3} ${rim.y - 43} H ${board.x - 23} V ${rim.y - 8} H ${board.x - 3}`} stroke={theme.isDark ? '#E2E8F0' : '#64748B'} strokeWidth={2} fill="none" />
    <Line x1={rim.right} y1={rim.y} x2={board.x - 3} y2={rim.y} stroke={metal} strokeWidth={5} />
    <G opacity={entered ? 1 : 0.85}>
      <Path d={`M ${rim.left} ${rim.y} L ${rim.left + netTaper} ${bottom} H ${rim.right - netTaper} L ${rim.right} ${rim.y}`} stroke={net} strokeWidth={2} fill={net} fillOpacity={0.06} />
      {[0.15, 0.35, 0.55, 0.75, 0.9].map((t, i) => <Path key={i} d={`M ${rim.left + (rim.right - rim.left) * t} ${rim.y} L ${rim.left + netTaper + Math.max(0, t - 0.16) * (rim.right - rim.left - 2 * netTaper)} ${bottom} M ${rim.left + (rim.right - rim.left) * t} ${rim.y} L ${rim.left + netTaper + Math.min(1, t + 0.16) * (rim.right - rim.left - 2 * netTaper)} ${bottom}`} stroke={net} strokeWidth={1.4} fill="none" />)}
      {[0.35, 0.7].map(t => <Line key={t} x1={rim.left + netTaper * t} x2={rim.right - netTaper * t} y1={rim.y + netDepth * t} y2={rim.y + netDepth * t} stroke={net} strokeWidth={1.4} />)}
    </G>
    <Line x1={rim.left} x2={rim.right} y1={rim.y} y2={rim.y} stroke={success ? theme.colors.success : '#F97316'} strokeWidth={rim.radius * 2} strokeLinecap="round" />
    {[rim.left, rim.right].map(x => <Circle key={x} cx={x} cy={rim.y} r={rim.radius} fill="#EA580C" />)}
    {impact > 0 ? <Circle cx={mid} cy={rim.y} r={48} fill="none" stroke="#FB923C" strokeWidth={1.4} opacity={impact} /> : null}
  </G>;
}
