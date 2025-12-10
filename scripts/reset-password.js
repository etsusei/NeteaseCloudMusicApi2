#!/usr/bin/env node
/**
 * 重置用户密码脚本
 * 用法: DATABASE_URL="..." node scripts/reset-password.js <username> <new_password>
 */

const bcrypt = require('bcrypt');
const pool = require('../util/db');

async function resetPassword() {
  const username = process.argv[2];
  const newPassword = process.argv[3];

  if (!username || !newPassword) {
    console.log('用法: node scripts/reset-password.js <用户名> <新密码>');
    process.exit(1);
  }

  try {
    // 检查用户是否存在
    const userResult = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      console.log(`❌ 用户 "${username}" 不存在`);
      process.exit(1);
    }

    // 更新密码
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [passwordHash, username]
    );

    console.log(`✅ 用户 "${username}" 密码已重置为: ${newPassword}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ 重置密码失败:', err.message);
    process.exit(1);
  }
}

resetPassword();
