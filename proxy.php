<?php
/**
 * 音乐代理接口 - 伪造请求头获取歌曲URL
 * 使用方式: /proxy.php?id=歌曲ID
 */

// 允许跨域
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Content-Type: application/json; charset=utf-8');

// 获取歌曲ID
$id = isset($_GET['id']) ? trim($_GET['id']) : '';

if (empty($id) || !is_numeric($id)) {
    http_response_code(400);
    echo json_encode([
        'code' => 400,
        'msg' => 'Missing or invalid id parameter',
        'url' => null
    ]);
    exit;
}

// 目标API
$targetUrl = "https://fy-musicbox-api.mu-jie.cc/meting/?server=netease&type=url&id=" . $id;

// 初始化 cURL
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_HTTPHEADER => [
        'Referer: https://mu-jie.cc/',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Accept: */*',
        'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        'sec-fetch-dest: audio',
        'sec-fetch-mode: no-cors',
        'sec-fetch-site: same-site',
    ],
]);

$response = curl_exec($ch);
$error = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);

curl_close($ch);

// 检查错误
if ($error) {
    http_response_code(500);
    echo json_encode([
        'code' => 500,
        'msg' => 'Curl error: ' . $error,
        'url' => null
    ]);
    exit;
}

// 返回结果
echo json_encode([
    'code' => $httpCode,
    'msg' => $httpCode == 200 ? 'success' : 'Request failed',
    'url' => $finalUrl,
    'id' => $id
]);
