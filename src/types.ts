import type {
  ActionRowBuilder,
  BaseMessageOptions,
  ButtonBuilder,
  ButtonInteraction,
  ContainerBuilder,
  EmbedBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalMessageModalSubmitInteraction,
  RepliableInteraction,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';

/** Full message options. For Components V2, set `flags: MessageFlags.IsComponentsV2`. */
export type PageOptions = Omit<BaseMessageOptions, 'flags'> & {
  flags?: MessageFlags | number;
};

/** Top-level Components V2 builders; the V2 flag is added for you. */
export type V2Component =
  | ContainerBuilder
  | TextDisplayBuilder
  | SectionBuilder
  | SeparatorBuilder
  | MediaGalleryBuilder
  | FileBuilder;

/**
 * A page can be:
 *  - a string or an EmbedBuilder (regular message)
 *  - a ContainerBuilder / TextDisplayBuilder / ... (Components V2)
 *  - full message options (either mode)
 * All pages of one pagination must use the same mode (regular or V2).
 */
export type PageInput = string | EmbedBuilder | V2Component | PageOptions;

export type ControlAction = 'first' | 'prev' | 'next' | 'last' | 'jump';

export interface ControlsState {
  /** Zero-based current page. */
  page: number;
  pageCount: number;
  /** True once the session has timed out; render everything disabled. */
  disabled: boolean;
  /** Builds the customId for an action: `new ButtonBuilder().setCustomId(id('next'))` */
  id(action: ControlAction): string;
}

export type Controls = (
  state: ControlsState,
) => ActionRowBuilder<ButtonBuilder>[];

export interface PaginateOptions {
  /** Idle time in ms before the buttons get disabled. Default: 120_000. */
  timeout?: number;
  /** Only the command author can use the buttons. Default: true. */
  ownerOnly?: boolean;
  /** Send the reply as ephemeral (ignored if you already replied/deferred). */
  ephemeral?: boolean;
  /** Zero-based page to open on. Default: 0. */
  startPage?: number;
  /** Custom controls renderer. Default: first / prev / [jump] / next / last. */
  controls?: Controls;
  /** Text for the "jump to page" modal opened by the default indicator button. */
  jumpModal?: {
    title?: string;
    label?: string | ((pageCount: number) => string);
  };
  /**
   * Called when someone other than the owner presses a button (needs `ownerOnly`).
   * The package sends no reply of its own: if you provide this, YOU must respond
   * to the interaction. Without it the press is acknowledged silently.
   */
  onDenied?: (interaction: ButtonInteraction) => void | Promise<void>;
  /**
   * Called when the jump modal is submitted with something that isn't a valid page.
   * Same rule: if you provide it you must respond; otherwise it's acknowledged silently.
   */
  onInvalidPage?: (
    interaction: ModalMessageModalSubmitInteraction,
    input: string,
  ) => void | Promise<void>;
  /**
   * Called when handling a button press fails (e.g. `fetchPage` throws). The
   * interaction is already acknowledged, so you can `followUp()` if you want.
   * Default: console.error.
   */
  onError?: (
    error: unknown,
    interaction: ButtonInteraction,
  ) => void | Promise<void>;
}

export interface StaticPagination extends PaginateOptions {
  pages: PageInput[];
}

export interface DynamicPagination extends PaginateOptions {
  pageCount: number;
  /** Called with a zero-based index. */
  fetchPage: (
    index: number,
    interaction: RepliableInteraction,
  ) => PageInput | Promise<PageInput>;
  /** How many fetched pages to keep (LRU). 0 disables caching. Default: 5. */
  cache?: number;
}

export type PaginateInput = PageInput[] | StaticPagination | DynamicPagination;

export type PaginationController = {
  refresh: (page?: number) => Promise<void>;
};
