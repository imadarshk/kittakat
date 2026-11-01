module.exports={apps:[{
  name:'kittakat',
  script:'/home/jelastic/kittakat/current/server.js',
  cwd:'/home/jelastic/kittakat/current',
  exec_mode:'fork',instances:1,
  autorestart:true,restart_delay:3000,min_uptime:'10s',max_restarts:10,
  max_memory_restart:'550M',kill_timeout:10000,
  out_file:'/home/jelastic/kittakat/logs/app.log',
  error_file:'/home/jelastic/kittakat/logs/error.log',
  log_date_format:'YYYY-MM-DD HH:mm:ss Z',
  env:{
    NODE_ENV:'production',PORT:'3000',HOSTNAME:'0.0.0.0',NEXT_TELEMETRY_DISABLED:'1',
    KITTAKAT_DB_PATH:'/home/jelastic/kittakat/data/kittakat.sqlite',
    KITTAKAT_PUBLIC_ORIGIN:'https://node27006-kittakat.ktm.yetiappcloud.com',
    KITTAKAT_MIGRATIONS_DIR:'/home/jelastic/kittakat/current/drizzle'
  }
}]};
