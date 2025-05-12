#!/usr/bin/env node

import fs from 'node:fs';
import { Wad } from '../Wad.mjs';

const args = process.argv.slice(2);
const [wadFile, mapName] = args;

const wad = new Wad( fs.readFileSync(wadFile) );

console.error(`${wad.type} ${wad.format} ${wadFile}`);
console.error(wad.info);

if(mapName)
{
	const map = wad.loadMap(mapName);
	const data = map.splitMap(mapName);
	fs.writeFileSync('./' + mapName + '.WAD', data);
}
else
{
	for(const mapName of wad.findMaps())
	{
		const map = wad.loadMap(mapName);
		const data = map.splitMap(mapName);
		fs.writeFileSync('./' + mapName + '.WAD', data);
	}
}
