import {
  ComponentType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type EmbedBuilder,
  type RepliableInteraction,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { defaultControls } from './controls';
import type {
  ControlAction,
  DynamicPagination,
  PageInput,
  PageOptions,
  PaginateInput,
  PaginateOptions,
  PaginationController,
  StaticPagination,
  V2Component,
} from './types';

type Page = PageOptions;

/** Loads a page. `fresh` drops every cached page first (used by `refresh()`). */
type Loader = (index: number, fresh?: boolean) => Promise<Page>;

const noop = () => undefined;

const isV2 = (page: Page) =>
  (Number(page.flags ?? 0) & MessageFlags.IsComponentsV2) !== 0;

/**
 * Builders are detected by shape, not instanceof: if this module and your bot
 * resolve different copies of discord.js, instanceof silently fails.
 *
 * Embed JSON has no numeric `type`; Components V2 JSON always does.
 */
function toPage(input: PageInput): Page {
  if (typeof input === 'string') return { content: input, embeds: [] };

  if ('toJSON' in input && typeof input.toJSON === 'function') {
    const json = input.toJSON() as { type?: unknown };

    return typeof json.type === 'number'
      ? {
          flags: MessageFlags.IsComponentsV2,
          components: [input as V2Component],
        }
      : { content: '', embeds: [input as EmbedBuilder] };
  }

  const page = input as Page;

  // V2 messages can't have content/embeds. For regular pages, the defaults
  // make sure the previous page's content/embeds get cleared on edit.
  return isV2(page) ? page : { content: '', embeds: [], ...page };
}

/** Tiny LRU: re-inserting a Map key marks it as recently used. */
class Lru<V> {
  private map = new Map<number, V>();

  constructor(private limit: number) {}

  get(key: number): V | undefined {
    const value = this.map.get(key);

    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }

    return value;
  }

  set(key: number, value: V): void {
    if (this.limit <= 0) return;

    this.map.delete(key);
    this.map.set(key, value);

    if (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value!);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

const MIXED_MODES =
  "Pages can't mix Components V2 and regular (content/embeds) pages.";

function createLoader(
  config: StaticPagination | DynamicPagination,
  interaction: RepliableInteraction,
): Loader {
  if ('pages' in config) {
    const pages = config.pages.map(toPage);

    if (new Set(pages.map(isV2)).size > 1) {
      throw new TypeError(MIXED_MODES);
    }

    return async (index) => pages[index];
  }

  const { fetchPage } = config;
  const cache = new Lru<Page>(config.cache ?? 5);
  let v2: boolean | undefined;

  return async (index, fresh = false) => {
    if (fresh) cache.clear();

    const hit = cache.get(index);

    if (hit) return hit;

    const page = toPage(await fetchPage(index, interaction));

    v2 ??= isV2(page);

    if (isV2(page) !== v2) {
      throw new TypeError(MIXED_MODES);
    }

    cache.set(index, page);
    return page;
  };
}

async function askPage(
  button: ButtonInteraction,
  prefix: string,
  pageCount: number,
  current: number,
  text: NonNullable<PaginateOptions['jumpModal']> = {},
) {
  const modalId = `${prefix}modal`;

  const label =
    typeof text.label === 'function'
      ? text.label(pageCount)
      : (text.label ?? `Page number (1-${pageCount})`);

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(text.title ?? 'Jump to page')
    .addLabelComponents(
      new LabelBuilder().setLabel(label).setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('page')
          .setPlaceholder(String(current + 1))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(String(pageCount).length)
          .setRequired(true),
      ),
    );

  await button.showModal(modal);

  const submit = await button
    .awaitModalSubmit({
      time: 60_000,
      filter: (m) => m.customId === modalId && m.user.id === button.user.id,
    })
    .catch(() => undefined);

  if (!submit || !submit.isFromMessage()) return undefined;

  return {
    submit,
    value: submit.fields.getTextInputValue('page'),
  };
}

type Answer = NonNullable<Awaited<ReturnType<typeof askPage>>>;

export async function paginate(
  interaction: RepliableInteraction,
  input: PaginateInput,
): Promise<PaginationController> {
  const config: StaticPagination | DynamicPagination = Array.isArray(input)
    ? { pages: input }
    : input;

  const pageCount = 'pages' in config ? config.pages.length : config.pageCount;

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError('Pagination needs at least one page.');
  }

  const {
    timeout = 120_000,
    ownerOnly = true,
    ephemeral = false,
    controls = defaultControls,
    jumpModal,
    onDenied,
    onInvalidPage,
    onError = (error: unknown) => console.error(error),
  } = config;

  const load = createLoader(config, interaction);
  const prefix = `pg:${randomBytes(4).toString('hex')}:`;
  const id = (action: ControlAction) => prefix + action;

  let current = Math.min(Math.max(config.startPage ?? 0, 0), pageCount - 1);

  let content = await load(current);
  let busy = false;
  let ended = false;

  const build = (disabled = false): Page => ({
    ...content,
    components: [
      ...(content.components ?? []),
      // A single page doesn't need navigation controls.
      ...(pageCount > 1
        ? controls({ page: current, pageCount, disabled, id })
        : []),
    ],
  });

  const controller: PaginationController = {
    refresh: async (page = current) => {
      // Ignored while a navigation is running, and once the session has expired
      // (redrawing would bring back buttons that no longer respond).
      if (busy || ended) return;

      busy = true;

      try {
        const target = Math.min(Math.max(page, 0), pageCount - 1);

        // `fresh` clears the cache so changed data is actually refetched.
        content = await load(target, true);
        current = target;

        await interaction.editReply(build() as never);
      } finally {
        busy = false;
      }
    },
  };

  // Casts: discord.js types flags differently for reply/edit; payloads are valid.
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(build() as never);
  } else {
    const flags =
      Number(content.flags ?? 0) | (ephemeral ? MessageFlags.Ephemeral : 0);

    await interaction.reply({
      ...build(),
      flags: flags || undefined,
    } as never);
  }

  if (pageCount === 1) return controller;

  const message = await interaction.fetchReply();

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: timeout,
    filter: (i) => i.customId.startsWith(prefix),
  });

  const handle = async (button: ButtonInteraction) => {
    if (ownerOnly && button.user.id !== interaction.user.id) {
      if (onDenied) {
        await onDenied(button);
      } else {
        await button.deferUpdate().catch(noop);
      }

      return;
    }

    const action = button.customId.slice(prefix.length);

    // Wait for the modal before acquiring the lock. Dismissing a modal
    // doesn't send an event, so holding the lock would block navigation.
    let jump:
      | {
          submit: Answer['submit'];
          page: number;
        }
      | undefined;

    if (action === 'jump') {
      let answer: Answer | undefined;

      try {
        answer = await askPage(button, prefix, pageCount, current, jumpModal);
      } finally {
        collector.resetTimer();
      }

      if (!answer) return;

      const n = Number(answer.value.trim());

      if (!Number.isInteger(n) || n < 1 || n > pageCount) {
        if (onInvalidPage) {
          await onInvalidPage(answer.submit, answer.value);
        } else {
          await answer.submit.deferUpdate().catch(noop);
        }

        return;
      }

      jump = {
        submit: answer.submit,
        page: n - 1,
      };
    }

    if (busy) {
      await (jump?.submit ?? button).deferUpdate().catch(noop);
      return;
    }

    busy = true;

    try {
      let target: number;
      let respond: (page: Page) => Promise<unknown>;

      if (jump) {
        const { submit } = jump;

        await submit.deferUpdate();

        target = jump.page;
        respond = (page) => submit.editReply(page as never);
      } else {
        await button.deferUpdate();

        const moves: Record<string, number | undefined> = {
          first: 0,
          prev: current - 1,
          next: current + 1,
          last: pageCount - 1,
        };

        target = moves[action] ?? current;
        respond = (page) => button.editReply(page as never);
      }

      target = Math.min(Math.max(target, 0), pageCount - 1);

      content = await load(target);
      current = target;

      await respond(build());
    } finally {
      busy = false;
    }
  };

  collector.on('collect', (button) => {
    handle(button).catch(async (error) => {
      try {
        await onError(error, button);
      } catch {
        // Never let a user handler crash the process.
      }
    });
  });

  // Disable navigation buttons when the collector expires.
  collector.on('end', () => {
    ended = true;
    void interaction.editReply(build(true) as never).catch(noop);
  });

  return controller;
}
