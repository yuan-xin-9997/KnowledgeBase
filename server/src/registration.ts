import { z } from "zod";

export const newPasswordSchema = z.string().min(8, "密码至少 8 位").max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "密码 UTF-8 编码不能超过 72 字节");

export const registerSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱"),
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点和短横线"),
  password: newPasswordSchema,
  displayName: z.string().trim().max(64).optional(),
});
