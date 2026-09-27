import { describe, expect, it } from 'vitest'
import { validateProjectImageFile } from '../src/features/notifications/projectStorage'

describe('private project image validation',()=>{
  it('accepts only a supported image type and files up to ten megabytes',()=>{
    expect(validateProjectImageFile({type:'image/png',size:1024} as File)).toBe('png')
    expect(validateProjectImageFile({type:'image/jpeg',size:10*1024*1024} as File)).toBe('jpg')
    expect(()=>validateProjectImageFile({type:'application/pdf',size:100} as File)).toThrow(/JPEG, PNG, WebP/)
    expect(()=>validateProjectImageFile({type:'image/webp',size:10*1024*1024+1} as File)).toThrow(/10MB/)
    expect(()=>validateProjectImageFile({type:'image/png',size:0} as File)).toThrow(/10MB/)
  })
})
