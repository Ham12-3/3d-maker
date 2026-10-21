import { z } from "zod";
import { patchEnvironment } from "@/scene/ops";
import { EnvironmentSchema } from "@/scene/schema";
import { defineTool } from "./types";

const E = EnvironmentSchema.shape;

const input = z.object({
  timeOfDay: E.timeOfDay
    .optional()
    .describe("0-24. Sunrise ~5.5, noon 12, golden hour 17.5, sunset 18.3, night 20-4"),
  sky: E.sky.optional(),
  fog: E.fog
    .partial()
    .optional()
    .describe(
      "density 0.004 light haze, 0.008 light mist, 0.012 misty, 0.025 thick (you can see about 0.85/density metres)",
    ),
  sun: E.sun.partial().optional(),
  ambient: E.ambient.partial().optional(),
  stars: E.stars.optional(),
  weather: E.weather.optional(),
  terrain: E.terrain
    .partial()
    .optional()
    .describe("type flat|hills|island|valley; height in metres (0-60)"),
  postfx: E.postfx.partial().optional(),
  ambience: E.ambience,
});

export const setEnvironmentTool = defineTool({
  name: "set_environment",
  pending: "Changing the environment",
  description: [
    "Change the world's environment: time of day, sky, fog, sun, ambient light, stars, weather, terrain, post effects.",
    "Only send the fields you want to change; nested objects (fog, sun, terrain...) are merged. Changes animate smoothly.",
    "Call this first for mood changes ('make it night', 'foggy', 'sunset') before adding objects.",
    "Keep fog colour matching the sky: warm peach at sunset, pale grey-blue by day, deep navy at night.",
    'Examples: night => {"timeOfDay":22,"sky":"night","stars":true,"fog":{"color":"#0b1430"}}.',
    'Misty sunset => {"timeOfDay":18,"sky":"sunset","fog":{"enabled":true,"color":"#e9a07c","density":0.01}}.',
  ].join(" "),
  input,
  execute(patch, ctx) {
    const changed = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
    if (changed.length === 0) return { ok: false, error: "No environment fields given." };
    ctx.edit("Set environment", patchEnvironment(patch));
    const env = ctx.getWorld().environment;
    return {
      ok: true,
      activity: "Changed the environment",
      result: `Environment now: time ${env.timeOfDay}, sky ${env.sky}, fog ${env.fog.enabled ? `on (${env.fog.density}, ${env.fog.color})` : "off"}, stars ${env.stars}, terrain ${env.terrain.type}.`,
    };
  },
});
