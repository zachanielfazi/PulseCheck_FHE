pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedSurveySystem is ZamaEthereumConfig {
    struct EncryptedResponse {
        euint32 encryptedScore;
        uint256 departmentId;
        uint256 questionId;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedScore;
    }

    struct SurveyMetadata {
        string surveyName;
        uint256 startTime;
        uint256 endTime;
        bool isActive;
    }

    mapping(uint256 => SurveyMetadata) public surveys;
    mapping(uint256 => mapping(uint256 => EncryptedResponse[])) public responses;
    mapping(uint256 => uint256) public responseCounts;

    event SurveyCreated(uint256 surveyId, string surveyName);
    event ResponseSubmitted(uint256 surveyId, uint256 departmentId, uint256 questionId);
    event ResponseVerified(uint256 surveyId, uint256 departmentId, uint256 questionId, uint32 score);

    constructor() ZamaEthereumConfig() {}

    function createSurvey(
        uint256 surveyId,
        string calldata surveyName,
        uint256 startTime,
        uint256 endTime
    ) external {
        require(bytes(surveys[surveyId].surveyName).length == 0, "Survey already exists");
        require(endTime > startTime, "Invalid time range");
        
        surveys[surveyId] = SurveyMetadata({
            surveyName: surveyName,
            startTime: startTime,
            endTime: endTime,
            isActive: true
        });
        
        emit SurveyCreated(surveyId, surveyName);
    }

    function submitEncryptedResponse(
        uint256 surveyId,
        uint256 departmentId,
        uint256 questionId,
        externalEuint32 encryptedScore,
        bytes calldata inputProof
    ) external {
        require(surveys[surveyId].isActive, "Survey is not active");
        require(block.timestamp >= surveys[surveyId].startTime && block.timestamp <= surveys[surveyId].endTime, "Survey not in progress");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");
        
        euint32 encryptedValue = FHE.fromExternal(encryptedScore, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);
        
        responses[surveyId][departmentId].push(EncryptedResponse({
            encryptedScore: encryptedValue,
            departmentId: departmentId,
            questionId: questionId,
            timestamp: block.timestamp,
            isVerified: false,
            decryptedScore: 0
        }));
        
        responseCounts[surveyId]++;
        emit ResponseSubmitted(surveyId, departmentId, questionId);
    }

    function verifyResponse(
        uint256 surveyId,
        uint256 departmentId,
        uint256 questionId,
        uint256 responseIndex,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(responseIndex < responses[surveyId][departmentId].length, "Invalid response index");
        EncryptedResponse storage response = responses[surveyId][departmentId][responseIndex];
        require(!response.isVerified, "Response already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(response.encryptedScore);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        response.decryptedScore = decodedValue;
        response.isVerified = true;
        
        emit ResponseVerified(surveyId, departmentId, questionId, decodedValue);
    }

    function getSurveyMetadata(uint256 surveyId) external view returns (
        string memory surveyName,
        uint256 startTime,
        uint256 endTime,
        bool isActive
    ) {
        SurveyMetadata storage survey = surveys[surveyId];
        return (survey.surveyName, survey.startTime, survey.endTime, survey.isActive);
    }

    function getResponseCount(uint256 surveyId) external view returns (uint256) {
        return responseCounts[surveyId];
    }

    function getEncryptedResponse(
        uint256 surveyId,
        uint256 departmentId,
        uint256 questionId,
        uint256 responseIndex
    ) external view returns (euint32) {
        require(responseIndex < responses[surveyId][departmentId].length, "Invalid response index");
        return responses[surveyId][departmentId][responseIndex].encryptedScore;
    }

    function getDecryptedResponse(
        uint256 surveyId,
        uint256 departmentId,
        uint256 questionId,
        uint256 responseIndex
    ) external view returns (uint32) {
        require(responseIndex < responses[surveyId][departmentId].length, "Invalid response index");
        require(responses[surveyId][departmentId][responseIndex].isVerified, "Response not verified");
        return responses[surveyId][departmentId][responseIndex].decryptedScore;
    }

    function getResponseDetails(
        uint256 surveyId,
        uint256 departmentId,
        uint256 questionId,
        uint256 responseIndex
    ) external view returns (
        uint256 respDepartmentId,
        uint256 respQuestionId,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedScore
    ) {
        require(responseIndex < responses[surveyId][departmentId].length, "Invalid response index");
        EncryptedResponse storage response = responses[surveyId][departmentId][responseIndex];
        
        return (
            response.departmentId,
            response.questionId,
            response.timestamp,
            response.isVerified,
            response.decryptedScore
        );
    }

    function closeSurvey(uint256 surveyId) external {
        require(surveys[surveyId].isActive, "Survey already closed");
        require(block.timestamp > surveys[surveyId].endTime, "Survey still in progress");
        surveys[surveyId].isActive = false;
    }
}

