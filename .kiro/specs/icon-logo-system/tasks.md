# Implementation Plan: Icon/Logo System for MCP Directory

## Overview

This implementation plan breaks down the Icon/Logo System into actionable tasks following a phased approach. The system replaces first-letter gradient avatars with actual project logos using a multi-source resolution strategy (GitHub → Favicon → OG → Custom → Fallback) with Cloudflare KV caching.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - Create directory structure for logo system
  - Define TypeScript interfaces for all data models (LogoMetadata, ServerLogo, LogoResult, LogoConfig)
  - Set up testing framework and configuration
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 2. Implement Cloudflare KV integration and Cache Manager
  - [x] 2.1 Set up Cloudflare KV namespace
    - Create KV namespace configuration
    - Implement basic get/set operations
    - _Requirements: 3.1, 3.2_
  
  - [x] 2.2 Implement Cache Manager with TTL support
    - Write Cache Manager class with get/set/invalidate methods
    - Implement 24-hour TTL enforcement
    - Add cache statistics tracking
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ]* 2.3 Write property test for Cache Manager
    - **Property 7: Cache storage on successful fetch**
    - **Validates: Requirements 3.1**
  
  - [ ]* 2.4 Write property test for TTL enforcement
    - **Property 8: 24-hour TTL enforcement**
    - **Validates: Requirements 3.2**

- [x] 3. Implement Configuration Manager
  - [x] 3.1 Create configuration schema and defaults
    - Define LogoConfig interface with all source and timeout settings
    - Implement environment-based configuration loading
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x] 3.2 Implement runtime configuration updates
    - Add watch/subscribe mechanism for config changes
    - Implement hot reload without restart
    - _Requirements: 9.5_
  
  - [ ]* 3.3 Write unit tests for Configuration Manager
    - Test configuration loading from environment
    - Test config update and notification flow
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 4. Implement GitHub Avatar Fetcher
  - [x] 4.1 Create GitHub API client
    - Implement authentication and rate limit handling
    - Add timeout support (1 second)
    - _Requirements: 2.1, 5.1, 5.2_
  
  - [x] 4.2 Implement avatar fetching logic
    - Fetch GitHub avatar URL from server metadata
    - Download and validate image
    - _Requirements: 2.1, 7.4, 7.5_
  
  - [ ]* 4.3 Write unit tests for GitHub Fetcher
    - Test successful avatar fetch
    - Test rate limit handling
    - Test error cases
    - _Requirements: 2.1, 5.1, 5.2_

- [-] 5. Implement Favicon API Fetcher
  - [x] 5.1 Integrate with Favicon API service
    - Configure API endpoint and authentication
    - Add request/response handling
    - _Requirements: 2.2, 5.1, 5.2_
  
  - [x] 5.2 Implement favicon extraction logic
    - Parse server URL and fetch favicon
    - Validate image format and size
    - _Requirements: 2.2, 7.4, 7.5_
  
  - [ ]* 5.3 Write unit tests for Favicon Fetcher
    - Test successful favicon fetch
    - Test API error handling
    - _Requirements: 2.2, 5.1, 5.2_

- [-] 6. Implement OG Image Fetcher
  - [x] 6.1 Create HTTP client for website fetching
    - Implement request timeout (1 second)
    - Add error handling for network failures
    - _Requirements: 2.3, 5.1, 5.2_
  
  - [x] 6.2 Implement OG image extraction
    - Parse HTML and extract Open Graph image
    - Download and validate image
    - _Requirements: 2.3, 7.4, 7.5_
  
  - [ ]* 6.3 Write unit tests for OG Fetcher
    - Test successful OG image extraction
    - Test missing OG image handling
    - _Requirements: 2.3, 5.1, 5.2_

- [-] 7. Implement Custom Repository Logo Fetcher
  - [x] 7.1 Create custom logo URL resolver
    - Implement custom logo URL configuration
    - Add fallback to standard logo paths
    - _Requirements: 2.4, 5.1, 5.2_
  
  - [x] 7.2 Implement custom logo fetching
    - Fetch custom logo from configured URL
    - Validate image format and size
    - _Requirements: 2.4, 7.4, 7.5_
  
  - [ ]* 7.3 Write unit tests for Custom Fetcher
    - Test successful custom logo fetch
    - Test missing custom logo handling
    - _Requirements: 2.4, 5.1, 5.2_

- [-] 8. Implement Logo Service with multi-source resolution
  - [x] 8.1 Create Logo Service core logic
    - Implement multi-source resolution strategy (GitHub → Favicon → OG → Custom)
    - Add retry logic with exponential backoff
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 8.2 Integrate with Cache Manager
    - Implement cache-first strategy
    - Add cache miss handling and storage
    - _Requirements: 3.3, 3.4, 3.5_
  
  - [x] 8.3 Implement timeout and error handling
    - Add 1-second timeout per source
    - Implement graceful degradation to fallback
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [ ]* 8.4 Write property test for multi-source resolution
    - **Property 5: Multi-source resolution priority**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
  
  - [ ]* 8.5 Write property test for null return on all sources failing
    - **Property 6: Null return on all sources failing**
    - **Validates: Requirements 2.5**

- [-] 9. Implement Metadata Serializer/Parser
  - [x] 9.1 Create JSON serializer for LogoMetadata
    - Implement serializeMetadata function
    - Preserve all fields during serialization
    - _Requirements: 10.1, 10.3_
  
  - [x] 9.2 Create JSON parser for LogoMetadata
    - Implement parseMetadata function
    - Add validation and error handling
    - _Requirements: 10.2, 10.5_
  
  - [ ]* 9.3 Write property test for round-trip serialization
    - **Property 42: Metadata round-trip property**
    - **Validates: Requirements 10.4**
  
  - [ ]* 9.4 Write property test for invalid metadata error handling
    - **Property 43: Invalid metadata error handling**
    - **Validates: Requirements 10.5**

- [-] 10. Implement Logo Component (Frontend)
  - [x] 10.1 Create Logo React component
    - Implement component with all required props
    - Add loading, loaded, error, and fallback states
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [x] 10.2 Implement accessibility attributes
    - Add alt text with server name for logos
    - Add aria-label with server name for fallback avatars
    - Implement keyboard navigation support
    - _Requirements: 6.1, 6.2, 6.4, 6.5_
  
  - [x] 10.3 Implement performance optimizations
    - Add low priority loading
    - Implement concurrent fetch limiting (max 4)
    - Add placeholder on slow fetch (>1 second)
    - _Requirements: 4.3, 4.4, 4.5_
  
  - [ ]* 10.4 Write component tests for Logo Component
    - Test rendering with various states
    - Test accessibility attribute presence
    - Test fallback avatar rendering
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2_

- [-] 11. Implement Image Processing Pipeline
  - [x] 11.1 Create image resizer
    - Scale logos to 48x48px bounds
    - Maintain aspect ratio
    - _Requirements: 7.1_
  
  - [x] 11.2 Implement transparency handling
    - Render transparent logos on white background
    - Handle alpha channel properly
    - _Requirements: 7.2_
  
  - [x] 11.3 Create image cropper for non-square logos
    - Implement center crop to square
    - Handle various aspect ratios
    - _Requirements: 7.3_
  
  - [x] 11.4 Implement file size validation
    - Reject logos larger than 500KB
    - Return appropriate error
    - _Requirements: 7.4_
  
  - [x] 11.5 Add image corruption detection
    - Validate image format
    - Display fallback on corruption
    - _Requirements: 7.5_
  
  - [ ]* 11.6 Write unit tests for image processing
    - Test resizing with various inputs
    - Test transparency handling
    - Test file size validation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 12. Implement Monitoring System
  - [x] 12.1 Create metrics collection infrastructure
    - Track logo fetch success rate
    - Track cache hit rate
    - Track average fetch latency
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 12.2 Implement alerting system
    - Configure alert on cache hit rate < 80%
    - Add error rate monitoring
    - _Requirements: 8.4_
  
  - [ ]* 12.3 Write property test for success rate tracking
    - **Property 30: Success rate tracking**
    - **Validates: Requirements 8.1**
  
  - [ ]* 12.4 Write property test for cache hit rate tracking
    - **Property 31: Cache hit rate tracking**
    - **Validates: Requirements 8.2**

- [-] 13. Integration and wiring
  - [x] 13.1 Wire Logo Service with all fetchers
    - Connect GitHub, Favicon, OG, and Custom fetchers
    - Implement resolution strategy
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 13.2 Integrate Logo Component with Logo Service
    - Connect frontend component to backend service
    - Implement loading state handling
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [x] 13.3 Connect monitoring to all components
    - Add metrics collection to Logo Service
    - Add metrics collection to Cache Manager
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [ ]* 13.4 Write integration tests for end-to-end flow
    - Test complete logo resolution chain
    - Test fallback scenarios
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Performance testing and optimization
  - [x] 15.1 Test LCP performance
    - Verify LCP < 2.5s for directory page
    - Optimize logo loading strategy
    - _Requirements: 4.1_
  
  - [x] 15.2 Verify cache hit rate
    - Test cache hit rate ≥ 90%
    - Optimize cache configuration
    - _Requirements: 4.2_
  
  - [ ]* 15.3 Write property test for concurrent fetch limiting
    - **Property 13: Concurrent fetch limit**
    - **Validates: Requirements 4.4**
  
  - [ ]* 15.4 Write property test for low priority loading
    - **Property 12: Low priority logo loading**
    - **Validates: Requirements 4.3**

- [x] 16. Final checkpoint - Ensure all tests pass and system is ready for deployment
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Implementation follows the 8-week phased plan from the design document
- All code uses TypeScript as specified in the design document
