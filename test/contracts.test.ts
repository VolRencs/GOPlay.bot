import test from "node:test";
import assert from "node:assert/strict";
import { fromDto as fromAutomod, toDto as toAutomod } from "../src/contracts/automod.ts";
import { toDto as toAppeal } from "../src/contracts/appeals.ts";
import { toDto as toAudit } from "../src/contracts/audit.ts";
import { toDto as toEmbed, sendingToDto } from "../src/contracts/embeds.ts";
import { fromDto as fromLevels, toDto as toLevels } from "../src/contracts/levels.ts";
import { fromDto as fromMusic, toDto as toMusic } from "../src/contracts/music.ts";
import { toDto as toRole } from "../src/contracts/roles.ts";
import { toDto as toTempPreset } from "../src/contracts/tempchannels.ts";
import { fromDto as fromWelcome, toDto as toWelcome } from "../src/contracts/welcome.ts";

test("welcome DTO converts booleans and image config", () => {
  const dto = toWelcome({ enabled: 1, channel_id: "1", message: "Hi", image_enabled: 0, background_path: null, image_config_json: "{}", goodbye_enabled: 1, goodbye_channel_id: null, goodbye_message: "Bye" });
  assert.equal(dto.enabled, true);
  assert.equal(dto.imageEnabled, false);
  assert.equal(dto.imageConfig.avatarWidth, 164);
  const row = fromWelcome(dto);
  assert.equal(row.enabled, 1);
  assert.equal(row.goodbye_enabled, 1);
});

test("levels DTO converts snake_case settings", () => {
  const dto = fromLevels({
    settings: {
      enabled: true, xpPerMessage: 12, messageCooldownSeconds: 30, minMessageLength: 2,
      xpPerVoiceMinute: 4, baseXp: 120, growthPercent: 8,
      ignoredChannelIds: ["1"], ignoredRoleIds: ["2"], notifyMode: "dm", notifyChannelId: null,
    },
    rewards: [{ level: 2, roleId: "3" }],
  });
  assert.equal(dto.settings.xp_per_message, 12);
  assert.equal(dto.rewards[0]?.role_id, "3");
  const back = toLevels(dto);
  assert.equal(back.settings.xpPerMessage, 12);
  assert.equal(back.rewards[0]?.roleId, "3");
});

test("music DTO converts snake_case settings", () => {
  const dto = fromMusic({ commandChannelId: "1", voiceChannelIds: ["2"], allowedRoleIds: ["3"], leaveAfterSeconds: 60, playlistsEnabled: true, playlistRoleIds: ["4"] });
  assert.equal(dto.command_channel_id, "1");
  assert.equal(dto.voice_channel_ids[0], "2");
  const back = toMusic(dto);
  assert.equal(back.commandChannelId, "1");
  assert.equal(back.playlistRoleIds[0], "4");
});

test("automod DTO parses actions and threshold", () => {
  const dto = toAutomod({ kind: "spam", enabled: 1, action_json: '["delete"]', threshold_json: '{"messages":5}', window_seconds: 10, escalation: 0 });
  assert.equal(dto.enabled, true);
  assert.deepEqual(dto.actions, ["delete"]);
  assert.equal(dto.threshold.messages, 5);
  assert.equal(dto.windowSeconds, 10);
  const row = fromAutomod(dto);
  assert.equal(row.enabled, 1);
  assert.equal(row.window_seconds, 10);
});

test("embed and sending DTOs expose camelCase", () => {
  const embed = toEmbed({ id: 1, name: "E", payload_json: '{"title":"T"}', mode: "embed", updated_at: 10, channel_id: "2", message_id: "3" });
  assert.equal(embed.updatedAt, 10);
  assert.equal(embed.payload.title, "T");
  assert.equal(embed.channelId, "2");
  const sending = sendingToDto({ id: 1, embed_id: 2, channel_id: "3", message_id: "4", sent_at: 5 });
  assert.deepEqual(sending, { id: 1, embedId: 2, channelId: "3", messageId: "4", sentAt: 5 });
});

test("role, appeal, audit and temp DTOs expose camelCase", () => {
  const role = toRole({ id: 1, channel_id: "2", message_id: "3", title: "T", style: "buttons", role_limit: 2, role_mode: "toggle", notify_enabled: 1, notify_template: null, role_id: "4", label: "L", emoji: null, button_color: "primary" });
  assert.equal(role.notifyEnabled, true);
  assert.equal(role.channelId, "2");
  const appeal = toAppeal({ id: 1, number: 2, guild_id: "3", user_id: "4", punishment_id: 5, type: "warn", reason: "r", moderator_comment: null, status: "pending", created_at: 6, updated_at: 7, reviewed_by: null, reviewed_at: null, punishment_reason: "p", punishment_created_at: 8 });
  assert.equal(appeal.punishmentReason, "p");
  assert.equal(appeal.createdAt, 6);
  const audit = toAudit({ id: 1, user_name: "U", section: "S", summary: "M", created_at: 9, total: 1 });
  assert.equal(audit.userName, "U");
  assert.equal(audit.createdAt, 9);
  const preset = toTempPreset({ id: 1, name: "P", trigger_channel_ids_json: '["2"]', category_id: null, name_template: "T", user_limit: 0, can_rename: 1, can_manage_access: 0, can_close: 1 });
  assert.equal(preset.triggerChannelIds[0], "2");
  assert.equal(preset.config.canRename, true);
  assert.equal(preset.config.canManageAccess, false);
});
