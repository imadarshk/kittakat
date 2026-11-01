declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ENABLE_CHATGPT_AUTH?: string;
    CLIENT_IP_HEADER?: string;
  }
}
