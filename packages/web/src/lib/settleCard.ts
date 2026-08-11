import { Money } from '@owewell/shared';
import type { SuggestedPayment } from './settlements';

export function settleCardRows(payments: SuggestedPayment[], limit = 4): {
  visible: SuggestedPayment[];
  hidden: number;
} {
  const safeLimit = Math.max(1, Math.floor(limit));
  return { visible: payments.slice(0, safeLimit), hidden: Math.max(0, payments.length - safeLimit) };
}

function fitText(ctx: CanvasRenderingContext2D, value: string, width: number): string {
  if (ctx.measureText(value).width <= width) return value;
  let text = value;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}

/** Make a square, locally rendered settle-up card suitable for a group chat. */
export async function renderSettleCard(
  groupName: string,
  payments: SuggestedPayment[],
): Promise<Blob | null> {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise(resolve => window.setTimeout(resolve, 400))]);
  }

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#f0edff');
  gradient.addColorStop(0.58, '#faf9ff');
  gradient.addColorStop(1, '#e8f7f2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(109,92,231,0.10)';
  ctx.beginPath();
  ctx.arc(910, 120, 250, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(47,155,131,0.08)';
  ctx.beginPath();
  ctx.arc(100, 990, 300, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#6d5ce7';
  ctx.font = '700 30px Inter, ui-sans-serif, sans-serif';
  ctx.fillText('OWEWELL  ·  SETTLE-UP', 76, 92);
  ctx.fillStyle = '#252234';
  ctx.font = "800 70px 'Bricolage Grotesque', Inter, ui-sans-serif, sans-serif";
  ctx.fillText(fitText(ctx, groupName, 920), 76, 178);

  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  ctx.fillStyle = '#6d5ce7';
  ctx.font = "800 94px 'Bricolage Grotesque', Inter, ui-sans-serif, sans-serif";
  ctx.fillText(Money.fromCents(total).format(), 76, 300);
  ctx.fillStyle = '#716d7c';
  ctx.font = '500 28px Inter, ui-sans-serif, sans-serif';
  ctx.fillText(`to clear in ${payments.length} ${payments.length === 1 ? 'transfer' : 'transfers'}`, 80, 346);

  const { visible, hidden } = settleCardRows(payments);
  visible.forEach((payment, index) => {
    const y = 398 + index * 126;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.strokeStyle = 'rgba(109,92,231,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(68, y, 944, 104, 28);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#252234';
    ctx.font = '700 32px Inter, ui-sans-serif, sans-serif';
    const route = `${payment.fromName}  →  ${payment.toName}`;
    ctx.fillText(fitText(ctx, route, 680), 102, y + 62);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6d5ce7';
    ctx.font = '800 34px Inter, ui-sans-serif, sans-serif';
    ctx.fillText(Money.fromCents(payment.amountCents).format(), 972, y + 62);
    ctx.textAlign = 'left';
  });

  if (hidden > 0) {
    ctx.fillStyle = '#716d7c';
    ctx.font = '600 25px Inter, ui-sans-serif, sans-serif';
    ctx.fillText(`+ ${hidden} more ${hidden === 1 ? 'transfer' : 'transfers'} in the app`, 80, 935);
  }
  ctx.fillStyle = '#252234';
  ctx.font = "800 34px 'Bricolage Grotesque', Inter, ui-sans-serif, sans-serif";
  ctx.fillText('less awkward money', 76, 1010);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#716d7c';
  ctx.font = '500 24px Inter, ui-sans-serif, sans-serif';
  ctx.fillText(new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), 1004, 1010);

  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
