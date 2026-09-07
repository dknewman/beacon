import { z } from 'zod';

export const parsedFieldSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.number().finite(), z.string(), z.boolean()]),
  unit: z.string().min(1).optional(),
});

export const parsedValueSchema = z.object({
  parserId: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  fields: z.array(parsedFieldSchema),
});
