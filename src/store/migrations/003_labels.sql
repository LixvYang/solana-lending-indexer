-- INPUT: 链下剧本地址元数据。OUTPUT: labels。POSITION: EP7 标签表。SYNC: 同步 folder.md。
CREATE TABLE labels (address TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT);
