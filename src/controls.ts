import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Controls, ControlAction } from './types';

export const defaultControls: Controls = ({
  page,
  pageCount,
  disabled,
  id,
}) => {
  const atStart = page === 0;
  const atEnd = page === pageCount - 1;

  const nav = (action: ControlAction, emoji: string, off: boolean) =>
    new ButtonBuilder()
      .setCustomId(id(action))
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || off);

  const jump = new ButtonBuilder()
    .setCustomId(id('jump'))
    .setLabel(`${page + 1} / ${pageCount}`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      nav('first', '⏮️', atStart),
      nav('prev', '◀️', atStart),
      jump,
      nav('next', '▶️', atEnd),
      nav('last', '⏭️', atEnd),
    ),
  ];
};
