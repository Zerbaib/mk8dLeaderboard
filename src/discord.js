const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, Events, PermissionFlagsBits, MessageFlags, ActivityType,
} = require('discord.js');
const store = require('./db');
const { COUNTRY_BY_CODE, REGION_BY_ID } = require('./countries');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const MOD_ROLE_ID = process.env.DISCORD_MOD_ROLE_ID; // optional
// Bot status (custom status shown under the bot's name)
const BOT_STATUS = process.env.DISCORD_BOT_STATUS || '🚀 go on mk8dxtimes.fr';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_ATTACH = 8 * 1024 * 1024; // above this size we send a link instead of the file

const COLORS = { pending: 0xf5b301, approved: 0x2ecc71, rejected: 0xe74c3c };
const LABELS = { pending: '⏳ Pending review', approved: '✅ Approved', rejected: '❌ Rejected' };

let client = null;
let ready = false;

const flag = (code) => (code && code.length === 2
  ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');

function proofLink(sub) {
  if (sub.proof_url) return sub.proof_url;
  if (sub.proof_file) return `${PUBLIC_URL}/uploads/${sub.proof_file}`;
  return null;
}

function buildEmbed(sub) {
  const track = store.TRACK_BY_ID[sub.track_id];
  const country = COUNTRY_BY_CODE[sub.country];
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${track ? track.name : sub.track_id} — ${sub.cc}cc`)
    .setColor(COLORS[sub.status])
    .addFields(
      { name: 'Player', value: sub.player_name, inline: true },
      { name: 'Time', value: `**${store.formatTime(sub.time_ms)}**`, inline: true },
      { name: 'Class', value: `${sub.cc}cc`, inline: true },
      { name: 'Country', value: `${flag(sub.country)} ${country ? country.name : sub.country}`, inline: true },
      { name: 'Region', value: REGION_BY_ID[country?.region]?.name || '—', inline: true },
      { name: 'Cup', value: track ? track.cup : '—', inline: true },
    )
    .setFooter({ text: `Submission #${sub.id} • ${LABELS[sub.status]}` })
    .setTimestamp(new Date(`${sub.created_at}Z`));

  const link = proofLink(sub);
  if (link) embed.addFields({ name: 'Proof', value: link });
  if (sub.comment) embed.addFields({ name: 'Comment', value: sub.comment.slice(0, 1000) });
  if (sub.status !== 'pending') {
    embed.addFields({ name: 'Reviewed by', value: sub.reviewed_by || '—', inline: true });
  }
  if (sub.status === 'rejected' && sub.reject_reason) {
    embed.addFields({ name: 'Rejection reason', value: sub.reject_reason.slice(0, 1000) });
  }
  if (sub.proof_file && /\.(png|jpe?g|gif|webp)$/i.test(sub.proof_file)) {
    embed.setImage(`attachment://${sub.proof_file}`);
  }
  return embed;
}

function buildButtons(sub, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mk8:approve:${sub.id}`).setLabel('Approve').setEmoji('✅')
      .setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`mk8:reject:${sub.id}`).setLabel('Reject').setEmoji('❌')
      .setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function notifySubmission(sub) {
  if (!ready) {
    console.warn(`[discord] Bot not connected: submission #${sub.id} stays pending.`);
    return;
  }
  const channel = await client.channels.fetch(CHANNEL_ID);
  const payload = { embeds: [buildEmbed(sub)], components: [buildButtons(sub)], files: [] };

  if (sub.proof_file) {
    const filePath = path.join(UPLOAD_DIR, sub.proof_file);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size <= MAX_ATTACH) {
      payload.files.push(new AttachmentBuilder(filePath, { name: sub.proof_file }));
    } else {
      payload.embeds[0].setImage(null);
    }
  }
  const message = await channel.send(payload);
  store.setDiscordMessage(sub.id, message.id);
}

function canModerate(interaction) {
  if (MOD_ROLE_ID) return interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
}

async function refreshMessage(interaction, sub) {
  const embed = buildEmbed(sub);
  // Keep the attachment already on the message
  if (!interaction.message.attachments.size) embed.setImage(null);
  await interaction.update({ embeds: [embed], components: [] });
}

async function handleInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('mk8:')) return;
  const [, action, rawId] = id.split(':');
  const subId = Number(rawId);

  if (!canModerate(interaction)) {
    await interaction.reply({ content: '⛔ You are not allowed to review submissions.', flags: MessageFlags.Ephemeral });
    return;
  }

  const reviewer = interaction.user.globalName || interaction.user.username;

  if (interaction.isButton() && action === 'approve') {
    const { sub, changed } = store.approveSubmission(subId, reviewer);
    if (!changed) {
      await interaction.reply({ content: `This submission has already been reviewed (${LABELS[sub.status]}).`, flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshMessage(interaction, sub);
    return;
  }

  if (interaction.isButton() && action === 'reject') {
    const sub = store.getSubmission(subId);
    if (!sub || sub.status !== 'pending') {
      await interaction.reply({ content: 'This submission has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId(`mk8:rejectmodal:${subId}`).setTitle(`Reject submission #${subId}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Rejection reason (optional)')
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
      ));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && action === 'rejectmodal') {
    const reason = interaction.fields.getTextInputValue('reason')?.trim();
    const { sub, changed } = store.rejectSubmission(subId, reviewer, reason);
    if (!changed) {
      await interaction.reply({ content: 'This submission has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }
    await refreshMessage(interaction, sub);
  }
}

async function start() {
  if (!TOKEN || !CHANNEL_ID) {
    console.warn('[discord] DISCORD_TOKEN or DISCORD_CHANNEL_ID missing: bot disabled.');
    return;
  }
  client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // Set at login and re-sent automatically on every reconnection
    presence: { status: 'online', activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: BOT_STATUS }] },
  });
  client.once(Events.ClientReady, (c) => {
    ready = true;
    console.log(`[discord] Logged in as ${c.user.tag}`);
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      console.error('[discord] Interaction error:', err);
      if (interaction.isRepliable() && !interaction.replied) {
        interaction.reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  });
  await client.login(TOKEN);
}

module.exports = { start, notifySubmission, buildEmbed, buildButtons, handleInteraction };
