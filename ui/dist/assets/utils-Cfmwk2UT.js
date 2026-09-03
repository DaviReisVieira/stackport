function n(t){const o=Math.floor(t/3600),r=Math.floor(t%3600/60),f=Math.floor(t%60);return o>0?`${o}h ${r}m`:r>0?`${r}m ${f}s`:`${f}s`}export{n as f};
