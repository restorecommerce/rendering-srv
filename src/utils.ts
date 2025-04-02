
export const marshallProtobufAny = (msg: any): any => ({
  type_url: 'rendering',
  value: Buffer.from(JSON.stringify(msg)),
});

export const unmarshallProtobufAny = (msg: any): any => JSON.parse(msg?.value?.toString());