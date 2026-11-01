declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ENABLE_CHATGPT_AUTH?: string;
    PUBLIC_ORIGIN?: string;
    TRUST_YETI_PROXY?: string;
  }
}
