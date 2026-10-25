# discord-pagination

Static and dynamic button pagination for discord.js v14 and CommandKit, with Components V2 support, a jump-to-page modal and customizable controls.

- One function: `paginate(interaction, pages)`
- **Static** pages (an array) or **dynamic** pages (fetched on demand, cached)
- Works with regular messages (content / embeds) **and Components V2**
- Default controls (first / previous / jump / next / last) or bring your own
- The page indicator is a button that opens a modal to jump to any page
- Returns a controller so you can refresh the displayed page from outside
- No global manager or `interactionCreate` wiring: each session uses its own collector
- Sends **no messages of its own**: denial, invalid input and errors are hooks you control

## Install

```sh
pnpm add discord-pagination
# npm install discord-pagination
```

`discord.js` (`^14.27.0`) is a **peer dependency**, so the package and your bot share a single copy.

## Quick start

### Static pages

```ts
import { EmbedBuilder } from 'discord.js';
import { paginate } from 'discord-pagination';

await paginate(interaction, [
  new EmbedBuilder().setTitle('Page one'),
  new EmbedBuilder().setTitle('Page two'),
  'A plain text page',
]);
```

### Dynamic pages

Pages are fetched when first visited and kept in a small LRU cache.

```ts
await paginate(interaction, {
  pageCount: Math.ceil(total / 10),
  fetchPage: async (index) => {
    const rows = await getRows(index * 10, 10);
    return new EmbedBuilder().setDescription(
      rows.map((r) => r.name).join('\n'),
    );
  },
});
```

### Components V2

Pass a `ContainerBuilder` (or `TextDisplayBuilder`, `SectionBuilder`, `SeparatorBuilder`, `MediaGalleryBuilder`, `FileBuilder`) directly. The `IsComponentsV2` flag is added for you.

```ts
const page = (text: string) =>
  new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Leaderboard'),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

await paginate(interaction, [page(a), page(b), page(c)]);
```

For several top-level components in one page, pass full options and set the flag yourself:

```ts
{ flags: MessageFlags.IsComponentsV2, components: [container, anotherComponent] }
```

### CommandKit

```ts
export const chatInput: ChatInputCommand = async (ctx) => {
  await ctx.interaction.deferReply();
  await paginate(ctx.interaction, pages);
};
```

## Pages

A page can be:

| Value                                                                                                                | Mode                                                |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `string`                                                                                                             | regular                                             |
| `EmbedBuilder`                                                                                                       | regular                                             |
| `ContainerBuilder`, `TextDisplayBuilder`, `SectionBuilder`, `SeparatorBuilder`, `MediaGalleryBuilder`, `FileBuilder` | Components V2                                       |
| message options object (`content`, `embeds`, `files`, `components`, `flags`, ...)                                    | regular, or V2 if `flags` includes `IsComponentsV2` |

All pages of one pagination must use the same mode. Mixing throws a `TypeError`, because Discord doesn't allow a message to switch between the two.

## Options

Pass options alongside `pages`, or alongside `pageCount` and `fetchPage`.

| Option          | Type                                                      | Default            | Description                                                                  |
| --------------- | --------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `pages`         | `PageInput[]`                                             |                    | Static mode.                                                                 |
| `pageCount`     | `number`                                                  |                    | Dynamic mode: total number of pages.                                         |
| `fetchPage`     | `(index, interaction) => PageInput \| Promise<PageInput>` |                    | Dynamic mode: load a page (zero-based index).                                |
| `cache`         | `number`                                                  | `5`                | Dynamic mode: pages kept in the LRU cache. `0` disables caching.             |
| `startPage`     | `number`                                                  | `0`                | Zero-based page to open on.                                                  |
| `timeout`       | `number`                                                  | `120000`           | Idle time (ms) before the buttons are disabled.                              |
| `ownerOnly`     | `boolean`                                                 | `true`             | Only the user who ran the command can press the buttons.                     |
| `ephemeral`     | `boolean`                                                 | `false`            | Send the first reply as ephemeral.                                           |
| `controls`      | `Controls`                                                | `defaultControls`  | Custom controls renderer (see below).                                        |
| `jumpModal`     | `{ title?, label? }`                                      | English text       | Text for the jump modal. `label` may be a string or `(pageCount) => string`. |
| `onDenied`      | `(interaction) => void`                                   | silent acknowledge | A non-owner pressed a button.                                                |
| `onInvalidPage` | `(interaction, input) => void`                            | silent acknowledge | The jump modal was submitted with an invalid page.                           |
| `onError`       | `(error, interaction) => void`                            | `console.error`    | Handling a press failed, e.g. `fetchPage` threw.                             |

### Hooks

The package never replies on its own. If you provide `onDenied` or `onInvalidPage`, **you must respond to the interaction**, otherwise Discord shows "This interaction failed". For `onError` the interaction is already acknowledged, so `followUp()` works. Errors thrown inside your handlers are swallowed so they can't crash the process.

```ts
await paginate(interaction, {
  pages,
  onDenied: (i) =>
    i.reply({ content: t('only_owner'), flags: MessageFlags.Ephemeral }),
  onInvalidPage: (i) =>
    i.reply({ content: t('invalid_page'), flags: MessageFlags.Ephemeral }),
  onError: (err, i) =>
    i.followUp({ content: t('page_failed'), flags: MessageFlags.Ephemeral }),
});
```

## Controller

`paginate()` resolves to a `PaginationController` once the first page has been sent.

```ts
type PaginationController = {
  refresh: (page?: number) => Promise<void>;
};
```

### `refresh(page?)`

Reloads and redraws the displayed page, optionally moving to another page (zero-based, clamped to the valid range). Use it when something outside the pagination changes what the pages should show, such as a sort menu or a filter.

```ts
let sort = 'name';

const pagination = await paginate(interaction, {
  pageCount,
  fetchPage: (index) => buildPage(sort, index),
});

// elsewhere, e.g. inside your own select-menu collector:
menu.deferUpdate();
sort = menu.values[0];
await pagination.refresh(0); // back to the first page with the new sort
```

Things to know:

- It edits the original reply through the original interaction, so it has the same 15 minute limit as any interaction token.
- If a navigation is already in progress, `refresh()` does nothing.
- `pageCount` is fixed when `paginate()` is called. `refresh()` can't change it, so start a new pagination if the number of pages changes.
- If your own components (like a select menu) trigger the refresh, acknowledge those interactions yourself with `deferUpdate()`.
- It does not revive an expired session. After the timeout the buttons stay disabled for good, so don't call `refresh()` once the collector has ended.

## Custom controls

`controls` is a function that receives the current state and returns button rows. Use `id(action)` to get the `customId` for one of the five actions: `first`, `prev`, `next`, `last`, `jump`.

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

await paginate(interaction, {
  pages,
  controls: ({ page, pageCount, disabled, id }) => [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(id('prev'))
        .setLabel('Back')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || page === 0),
      new ButtonBuilder()
        .setCustomId(id('jump'))
        .setLabel(`${page + 1} / ${pageCount}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(id('next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || page === pageCount - 1),
    ),
  ],
});
```

State passed to `controls`:

| Field        | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `page`       | Zero-based current page.                                       |
| `pageCount`  | Total number of pages.                                         |
| `disabled`   | `true` once the session timed out; render everything disabled. |
| `id(action)` | Builds the `customId` for an action.                           |

Controls are appended as top-level rows after your page's own components (including in Components V2 mode). The default controls are exported as `defaultControls` if you want to wrap or extend them.

## Behavior notes

- **Single page:** no controls are shown.
- **Jump modal:** the indicator button (`3 / 10`) opens a modal asking for a page number. Dismissing the modal doesn't block the other buttons.
- **Deferred interactions:** if you already called `deferReply()` / `reply()`, the pages replace that reply via `editReply`. Ephemeral is decided at `deferReply` time, so the `ephemeral` option is ignored in that case.
- **Caching:** dynamic pages are cached by index, so changed data can look stale until a page is evicted. Use `cache: 0` to always refetch, or call `refresh()`. Static pages need no cache.
- **Timeout:** the buttons are disabled after `timeout` ms without any press. Discord interaction tokens expire after 15 minutes, so timeouts longer than that can't edit the message anymore.
- **Components V2 limit:** a message can have 40 components in total, nested ones included. The default controls use 6 (one row and five buttons), leaving 34 for your content.
- **Sessions live in memory:** buttons stop working after a bot restart.

## Exports

```ts
import { paginate, defaultControls } from 'discord-pagination';
import type {
  ControlAction,
  Controls,
  ControlsState,
  DynamicPagination,
  PageInput,
  PageOptions,
  PaginateInput,
  PaginateOptions,
  PaginationController,
  StaticPagination,
  V2Component,
} from 'discord-pagination';
```

## License

MIT
