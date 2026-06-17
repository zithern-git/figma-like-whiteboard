# RESTful API 接口文档

## 基础信息

- **Base URL**: `http://localhost:3001/api`
- **Content-Type**: `application/json`
- **认证方式**: Bearer Token (JWT)

## 认证相关

### POST /auth/register
用户注册

**请求体**:
```json
{
  "name": "用户名",
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "name": "用户名",
    "email": "user@example.com"
  }
}
```

**错误码**:
| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | VALIDATION_ERROR | 参数验证失败 |
| 409 | EMAIL_EXISTS | 邮箱已存在 |

---

### POST /auth/login
用户登录

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "name": "用户名",
    "email": "user@example.com"
  }
}
```

**错误码**:
| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 401 | INVALID_CREDENTIALS | 邮箱或密码错误 |

---

### GET /auth/me
获取当前用户信息

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "用户名",
    "email": "user@example.com"
  }
}
```

---

## 白板相关

### GET /whiteboards
获取白板列表

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "whiteboards": [
    {
      "id": "...",
      "shortId": "abc123",
      "name": "我的白板",
      "ownerId": "...",
      "collaborators": [],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /whiteboards
创建白板

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "name": "新白板"
}
```

**响应**:
```json
{
  "success": true,
  "whiteboard": {
    "id": "...",
    "shortId": "abc123",
    "name": "新白板",
    "ownerId": "...",
    "elements": [],
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### GET /whiteboards/:shortId
获取白板详情

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "whiteboard": {
    "id": "...",
    "shortId": "abc123",
    "name": "我的白板",
    "ownerId": "...",
    "elements": [...],
    "collaborators": [...],
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

**错误码**:
| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 404 | WHITEBOARD_NOT_FOUND | 白板不存在 |
| 403 | FORBIDDEN | 无权限访问 |

---

### PUT /whiteboards/:shortId
更新白板信息

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "name": "新名称"
}
```

**响应**:
```json
{
  "success": true,
  "whiteboard": { ... }
}
```

---

### DELETE /whiteboards/:shortId
删除白板

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "message": "Whiteboard deleted"
}
```

---

### POST /whiteboards/:shortId/collaborators
添加协作者

**请求头**:
```
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "email": "collaborator@example.com",
  "role": "editor"
}
```

**响应**:
```json
{
  "success": true,
  "collaborator": {
    "userId": "...",
    "role": "editor"
  }
}
```

---

## 快照相关

### GET /whiteboards/:shortId/snapshots
获取白板快照列表

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "snapshots": [
    {
      "id": "...",
      "serverVersion": 100,
      "opCount": 100,
      "trigger": "interval",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /whiteboards/:shortId/snapshots
创建手动快照

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "snapshot": {
    "id": "...",
    "serverVersion": 100,
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### POST /whiteboards/:shortId/snapshots/:snapshotId/rollback
回滚到指定快照

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "message": "Rollback successful"
}
```

---

## 上传相关

### POST /upload/image
上传图片

**请求头**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**请求体**:
```
file: <图片文件>
```

**响应**:
```json
{
  "success": true,
  "url": "/uploads/xxx.jpg",
  "filename": "xxx.jpg"
}
```

**错误码**:
| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | NO_FILE | 未上传文件 |
| 413 | FILE_TOO_LARGE | 文件过大 |

---

## 通用错误响应格式

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

## 全局错误码

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未认证 |
| 403 | FORBIDDEN | 无权限 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突 |
| 413 | PAYLOAD_TOO_LARGE | 请求体过大 |
| 429 | TOO_MANY_REQUESTS | 请求过于频繁 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
