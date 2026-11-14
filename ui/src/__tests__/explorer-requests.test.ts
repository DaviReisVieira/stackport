import { describe, expect, it } from 'vitest'
import type { ExplorerOperation, ExplorerShapeGraph } from '@/lib/types'
import { exampleValue, fieldKind, firstSentence, missingRequired, withoutSensitive } from '@/components/cloudscape/views/explorer/shapes'
import { awsCliCommand, boto3Snippet } from '@/components/cloudscape/views/explorer/snippets'

const LOCAL = { endpointUrl: 'http://localhost:4566', region: 'eu-west-1' }
const AWS = { endpointUrl: null, region: 'us-east-1' }

function operation(overrides: Partial<ExplorerOperation>): ExplorerOperation {
  return {
    service: 'kms',
    name: 'Encrypt',
    documentation: '',
    access: 'write',
    deprecated: false,
    methodName: 'encrypt',
    cliCommand: 'kms encrypt',
    cliOptions: {},
    pagination: null,
    streamingInput: false,
    streamingOutput: false,
    eventStreamInput: false,
    eventStreamOutput: false,
    input: null,
    ...overrides,
  }
}

const encrypt = operation({
  cliOptions: { KeyId: '--key-id', Plaintext: '--plaintext', EncryptionContext: '--encryption-context' },
  input: {
    root: 'EncryptRequest',
    shapes: {
      EncryptRequest: {
        type: 'structure',
        required: ['KeyId', 'Plaintext'],
        members: [
          { name: 'KeyId', shape: 'KeyIdType' },
          { name: 'Plaintext', shape: 'PlaintextType' },
          { name: 'EncryptionContext', shape: 'EncryptionContextType' },
        ],
      },
      KeyIdType: { type: 'string', min: 1, max: 2048 },
      PlaintextType: { type: 'blob', sensitive: true },
      EncryptionContextType: { type: 'map', key: 'KeyIdType', value: 'KeyIdType' },
    },
  },
})

const getObject = operation({
  service: 's3',
  name: 'GetObject',
  access: 'read',
  methodName: 'get_object',
  cliCommand: 's3api get-object',
  cliOptions: { Bucket: '--bucket', Key: '--key', ChecksumMode: '--checksum-mode', PartNumber: '--part-number', Flag: '--flag', Tags: '--tags' },
  streamingOutput: true,
  input: {
    root: 'GetObjectRequest',
    shapes: {
      GetObjectRequest: {
        type: 'structure',
        required: ['Bucket', 'Key'],
        members: [
          { name: 'Bucket', shape: 'S' },
          { name: 'Key', shape: 'S' },
          { name: 'PartNumber', shape: 'I' },
          { name: 'Flag', shape: 'B' },
          { name: 'Tags', shape: 'L' },
        ],
      },
      S: { type: 'string' },
      I: { type: 'integer' },
      B: { type: 'boolean' },
      L: { type: 'list', member: 'S' },
    },
  },
})

// A shape that contains itself, like DynamoDB's AttributeValue
const recursive: ExplorerShapeGraph = {
  root: 'Request',
  shapes: {
    Request: { type: 'structure', required: ['Item'], members: [{ name: 'Item', shape: 'Value' }, { name: 'Secret', shape: 'Hidden' }] },
    Value: { type: 'structure', required: [], members: [{ name: 'S', shape: 'Text' }, { name: 'M', shape: 'ValueMap' }, { name: 'Password', shape: 'Hidden' }] },
    ValueMap: { type: 'map', key: 'Text', value: 'Value' },
    Text: { type: 'string' },
    Hidden: { type: 'string', sensitive: true },
  },
}

describe('AWS CLI command', () => {
  it('passes blobs in base64, as CLI v2 reads them', () => {
    const fromText = awsCliCommand({ operation: encrypt, params: { KeyId: 'k', Plaintext: 'hi ✓' }, paginate: false }, LOCAL)
    expect(fromText).toBe(
      `aws kms encrypt --cli-input-json '{"KeyId":"k","Plaintext":"aGkg4pyT"}' --endpoint-url http://localhost:4566 --region eu-west-1`,
    )
    const fromBase64 = awsCliCommand({ operation: encrypt, params: { KeyId: 'k', Plaintext: { $base64: '/wA=' } }, paginate: false }, AWS)
    expect(fromBase64).toBe(`aws kms encrypt --cli-input-json '{"KeyId":"k","Plaintext":"/wA="}' --region us-east-1`)
  })

  it('uses options and an output file for operations that save their response', () => {
    const command = awsCliCommand(
      { operation: getObject, params: { Bucket: 'b', Key: 'my file', PartNumber: 2, Flag: false, Tags: ['a'] }, paginate: false },
      LOCAL,
    )
    expect(command).toBe(
      `aws s3api get-object --bucket b --key 'my file' --part-number 2 --no-flag --tags '["a"]' --endpoint-url http://localhost:4566 --region eu-west-1 response.out`,
    )
  })

  it("lets the CLI follow pages only when the explorer does", () => {
    const listing = operation({ cliCommand: 'sqs list-queues', pagination: { inputTokens: ['NextToken'], limitKey: null, resultKeys: [] } })
    expect(awsCliCommand({ operation: listing, params: {}, paginate: false }, AWS)).toBe('aws sqs list-queues --no-paginate --region us-east-1')
    expect(awsCliCommand({ operation: listing, params: {}, paginate: true }, AWS)).toBe('aws sqs list-queues --region us-east-1')
  })
})

describe('boto3 code', () => {
  it('decodes base64 blobs and writes Python values', () => {
    const code = boto3Snippet({ operation: encrypt, params: { KeyId: 'k', Plaintext: { $base64: '/wA=' }, EncryptionContext: { on: 'yes' } }, paginate: false }, AWS)
    expect(code).toBe(
      [
        'import base64',
        '',
        'import boto3',
        '',
        'client = boto3.client("kms", region_name="us-east-1")',
        '',
        'response = client.encrypt(',
        '    KeyId="k",',
        '    Plaintext=base64.b64decode("/wA="),',
        '    EncryptionContext={"on": "yes"},',
        ')',
        'print(response)',
      ].join('\n'),
    )
  })

  it('uses a paginator when following pages', () => {
    const listing = operation({ service: 'sqs', methodName: 'list_queues', pagination: { inputTokens: ['NextToken'], limitKey: null, resultKeys: [] } })
    expect(boto3Snippet({ operation: listing, params: {}, paginate: true }, LOCAL).split('\n').slice(4)).toEqual([
      'paginator = client.get_paginator("list_queues")',
      'for page in paginator.paginate():',
      '    print(page)',
    ])
  })

  it('splits long values over lines', () => {
    const tags = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`tag-${i}`, `value-${i}`]))
    const code = boto3Snippet({ operation: encrypt, params: { KeyId: 'k', EncryptionContext: tags }, paginate: false }, AWS)
    expect(code).toContain('    EncryptionContext={\n        "tag-0": "value-0",\n')
    expect(code).toContain('        "tag-5": "value-5",\n    },\n')
  })
})

describe('request shapes', () => {
  it('stops an example at the first repeat of a recursive shape', () => {
    expect(exampleValue(recursive, 'Request')).toEqual({ Item: { S: '', M: { key: {} }, Password: '' }, Secret: '' })
  })

  it('leaves sensitive values out, however deep', () => {
    const params = { Item: { S: 'kept', Password: 'p', M: { inner: { Password: 'q', S: 'also kept' } } }, Secret: 's' }
    expect(withoutSensitive(recursive, 'Request', params)).toEqual({ Item: { S: 'kept', M: { inner: { S: 'also kept' } } } })
  })

  it('picks a control per shape', () => {
    expect(fieldKind(encrypt.input!.shapes.KeyIdType, encrypt.input!)).toBe('text')
    expect(fieldKind(encrypt.input!.shapes.PlaintextType, encrypt.input!)).toBe('blob')
    expect(fieldKind(encrypt.input!.shapes.EncryptionContextType, encrypt.input!)).toBe('stringMap')
    expect(fieldKind(getObject.input!.shapes.L, getObject.input!)).toBe('scalarList')
    expect(fieldKind(recursive.shapes.ValueMap, recursive)).toBe('json')
    expect(fieldKind(recursive.shapes.Value, recursive)).toBe('json')
  })

  it('describes a field with its first sentence, even when a list follows it', () => {
    expect(firstSentence('The filters.\n- affinity - The affinity setting.\n- architecture - The architecture.')).toBe('The filters.')
    expect(firstSentence('The name of the queue. Up to 80 characters.\n\nMore.')).toBe('The name of the queue.')
  })

  it('lists required parameters without a value', () => {
    expect(missingRequired(getObject.input, { Bucket: 'b', Key: '' })).toEqual(['Key'])
    expect(missingRequired(getObject.input, { Bucket: 'b', Key: 'k' })).toEqual([])
    expect(missingRequired(null, {})).toEqual([])
  })
})
